import { Policy, PolicyVersion } from '../src/database/models';
import { AssistantService, type Completer, type ModelMessage } from '../src/modules/assistant/assistant.service';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

describe('AI assistant (e2e)', () => {
  let ctx: TestContext;
  let assistant: AssistantService;
  let original: Completer;
  let calls: { messages: ModelMessage[]; tools: string[] }[];

  beforeAll(async () => {
    ctx = await createTestApp();
    assistant = ctx.app.get(AssistantService);
    original = assistant.completer;
  });
  beforeEach(async () => {
    await resetDatabase(ctx);
    calls = [];
  });
  afterAll(async () => {
    assistant.completer = original;
    await ctx.close();
  });

  /** A scripted model: each step sees the conversation so far and returns tool calls or an answer. */
  function script(steps: ((m: ModelMessage[]) => Awaited<ReturnType<Completer>>)[]) {
    let i = 0;
    assistant.completer = async (messages, tools) => {
      calls.push({ messages: [...messages], tools: tools.map((t) => t.function.name) });
      const step = steps[Math.min(i++, steps.length - 1)]!;
      return step(messages);
    };
  }
  const lastTool = (m: ModelMessage[]) => JSON.parse((m.filter((x) => x.role === 'tool').at(-1) as { content: string }).content);

  async function setup() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const user = await createUser(ctx, { email: uniqueEmail('e'), firstName: 'Asha', lastName: 'Rao' });
    const membership = await addMember(ctx, org.organization.id, user.id, ['employee']);
    await ctx.http().post(`${API}/employees`).set(h).send({ firstName: 'Asha', lastName: 'Rao', dateOfJoining: '2022-06-01', membershipId: membership.id });
    const eh = bearer((await login(ctx, user.email)).accessToken);
    // A published policy always has a current version (database check), so it's published with it.
    const policy = await Policy.create({ organizationId: org.organization.id, title: 'Leave policy', category: 'HR', summary: 'How leave is earned, taken and carried forward' }, RAW);
    const version = await PolicyVersion.create({ organizationId: org.organization.id, policyId: policy.id, version: 2, status: 'PUBLISHED', content: 'Annual leave accrues monthly. Unused casual leave lapses at year end. Up to 10 days of earned leave carry forward into the next leave year; anything above lapses.', effectiveFrom: '2026-04-01', publishedOn: '2026-04-01', publishedAt: new Date() }, RAW);
    await Policy.update({ status: 'PUBLISHED', currentVersionId: version.id }, { where: { id: policy.id }, ...RAW });
    return { ...org, h, eh };
  }

  it('is opt-in per organization; until then the app answers with the keyword assistant', async () => {
    const s = await setup();
    expect((await ctx.http().get(`${API}/assistant/status`).set(s.eh)).body.data).toEqual({ ai: false, available: true, enabled: false, canConfigure: false, model: 'gpt-4o-mini' });
    expect((await ctx.http().post(`${API}/assistant/chat`).set(s.eh).send({ messages: [{ role: 'user', content: 'How much leave do I have?' }] })).body.data).toMatchObject({ mode: 'fallback' });
    expect((await ctx.http().put(`${API}/assistant/settings`).set(s.eh).send({ enabled: true })).status).toBe(403);
    expect((await ctx.http().put(`${API}/assistant/settings`).set(s.h).send({ enabled: true })).body.data).toMatchObject({ ai: true, enabled: true, canConfigure: true });
    expect(calls).toHaveLength(0);
  });

  it('answers policy questions from the policy text through tools, with app links only', async () => {
    const s = await setup();
    await ctx.http().put(`${API}/assistant/settings`).set(s.h).send({ enabled: true });
    script([
      () => ({ content: null, toolCalls: [{ id: 'c1', name: 'search_policies', arguments: JSON.stringify({ query: 'carry forward earned leave' }) }] }),
      (m) => {
        const found = lastTool(m);
        expect(found.matches[0]).toMatchObject({ title: 'Leave policy', version: 2 });
        expect(found.matches[0].excerpt).toContain('Up to 10 days of earned leave carry forward');
        return { content: 'Up to 10 days of earned leave carry forward ([Leave policy](/me/policies)); the rest lapses. See [this](https://evil.example/x).', toolCalls: [] };
      },
    ]);
    const reply = (await ctx.http().post(`${API}/assistant/chat`).set(s.eh).send({ messages: [{ role: 'user', content: 'How much leave can I carry forward?' }] })).body.data;
    expect(reply).toEqual({ mode: 'ai', text: 'Up to 10 days of earned leave carry forward (Leave policy); the rest lapses. See this.', links: [{ label: 'Leave policy', to: '/me/policies' }], sources: ['search_policies'] });
    // The system prompt grounds the model and names the user; only the user's tools are offered.
    const system = calls[0]!.messages[0] as { content: string };
    expect(system.content).toContain('Asha Rao');
    expect(system.content).toContain('Answer only from the results of the tools');
    expect(calls[0]!.tools).toContain('search_policies');
  });

  it('runs tools only with the caller’s own access, and falls back when the provider fails', async () => {
    const s = await setup();
    await ctx.http().put(`${API}/assistant/settings`).set(s.h).send({ enabled: true });
    const colleague = await createUser(ctx, { email: uniqueEmail('r'), firstName: 'Ravi', lastName: 'Menon' });
    const m2 = await addMember(ctx, s.organization.id, colleague.id, ['employee']);
    await ctx.http().post(`${API}/employees`).set(s.h).send({ firstName: 'Ravi', lastName: 'Menon', dateOfJoining: '2023-01-02', membershipId: m2.id });

    let seen: unknown[] = [];
    script([
      () => ({ content: null, toolCalls: [{ id: 'c1', name: 'delete_everything', arguments: '{}' }, { id: 'c2', name: 'find_employee', arguments: '{"name":"Ravi"}' }, { id: 'c3', name: 'my_profile', arguments: '{}' }] }),
      (m) => {
        seen = (m.filter((x) => x.role === 'tool') as { content: string }[]).map((t) => JSON.parse(t.content));
        return { content: 'You joined on 1 June 2022.', toolCalls: [] };
      },
    ]);
    // An employee only sees their own record, so a colleague search finds nothing for them…
    expect((await ctx.http().post(`${API}/assistant/chat`).set(s.eh).send({ messages: [{ role: 'user', content: 'Who is Ravi and when did I join?' }] })).body.data).toMatchObject({ mode: 'ai', text: 'You joined on 1 June 2022.', sources: ['find_employee', 'my_profile'] });
    expect(seen[0]).toEqual({ error: 'Not available to this user' });
    expect(seen[1]).toEqual([]);
    expect(seen[2]).toMatchObject({ name: 'Asha Rao', dateOfJoining: '2022-06-01' });
    // …while the admin, who sees everyone, finds Ravi.
    script([() => ({ content: null, toolCalls: [{ id: 'c1', name: 'find_employee', arguments: '{"name":"Ravi"}' }] }), (m) => ((seen = [lastTool(m)]), { content: 'Found him.', toolCalls: [] })]);
    await ctx.http().post(`${API}/assistant/chat`).set(s.h).send({ messages: [{ role: 'user', content: 'Who is Ravi?' }] });
    expect(seen[0]).toEqual([expect.objectContaining({ name: 'Ravi Menon' })]);

    assistant.completer = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    expect((await ctx.http().post(`${API}/assistant/chat`).set(s.eh).send({ messages: [{ role: 'user', content: 'Hello' }] })).body.data).toEqual({ mode: 'fallback', reason: 'The AI provider is unavailable right now' });
    expect((await ctx.http().post(`${API}/assistant/chat`).set(s.eh).send({ messages: [] })).status).toBe(422);
  });
});
