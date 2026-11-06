import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PASSWORD_POLICY } from '@contracts';
import { ApiError } from '@/core/http/http-client';
import AppDataTable from '@/shared/components/data/AppDataTable.vue';
import AppDatePicker from '@/shared/components/forms/AppDatePicker.vue';
import AppOtpInput from '@/shared/components/forms/AppOtpInput.vue';
import AppPasswordChecklist from '@/shared/components/forms/AppPasswordChecklist.vue';
import AppSelect from '@/shared/components/forms/AppSelect.vue';
import type { TableColumn } from '@/shared/components/types';

interface Row {
  id: string;
  name: string;
}
const columns: TableColumn<Row>[] = [{ key: 'name', label: 'Name', sortField: 'name' }];

describe('AppDataTable', () => {
  it('renders rows', () => {
    const w = mount(AppDataTable, { props: { columns, rows: [{ id: '1', name: 'Asha' }, { id: '2', name: 'Ravi' }] } });
    expect(w.findAll('tbody tr')).toHaveLength(2);
    expect(w.text()).toContain('Asha');
  });

  it('shows skeleton rows while loading the first page', () => {
    const w = mount(AppDataTable, { props: { columns, rows: [], loading: true } });
    expect(w.findAll('tbody tr')).toHaveLength(5);
    expect(w.text()).not.toContain('No records found');
  });

  it('shows the empty state', () => {
    const w = mount(AppDataTable, { props: { columns, rows: [], emptyTitle: 'No users found' } });
    expect(w.text()).toContain('No users found');
  });

  it('shows the error state with request reference and retry', async () => {
    const w = mount(AppDataTable, { props: { columns, rows: [], error: new ApiError(500, 'INTERNAL_ERROR', 'Server exploded', [], 'req-42') } });
    expect(w.text()).toContain('Server exploded');
    expect(w.text()).toContain('req-42');
    await w.find('button').trigger('click');
    expect(w.emitted('retry')).toHaveLength(1);
  });

  it('toggles sort direction and exposes aria-sort', async () => {
    const w = mount(AppDataTable, { props: { columns, rows: [], sort: 'name:asc' } });
    expect(w.find('th').attributes('aria-sort')).toBe('ascending');
    await w.find('th button').trigger('click');
    expect(w.emitted('update:sort')![0]).toEqual(['name:desc']);
  });

  it('labels every cell for the small-screen card layout and offers a sort menu', async () => {
    const rows = [{ id: '1', name: 'Asha' }, { id: '2', name: 'Ravi' }];
    const w = mount(AppDataTable, { props: { columns, rows, sort: 'createdAt:desc' }, attachTo: document.body });
    expect(w.find('td').attributes('data-label')).toBe('Name');
    expect(w.find('td').attributes('role')).toBe('cell');
    const trigger = w.find('[role="combobox"][aria-label="Sort by"]');
    expect(trigger.text()).toContain('Default order');
    await trigger.trigger('click');
    const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent?.includes('Name (ascending)'));
    option!.click();
    expect(w.emitted('update:sort')![0]).toEqual(['name:asc']);
    w.unmount();
  });

  it('renders pagination from meta', () => {
    const w = mount(AppDataTable, { props: { columns, rows: [{ id: '1', name: 'A' }], meta: { page: 2, pageSize: 1, total: 3, totalPages: 3 } } });
    expect(w.text()).toContain('Page 2 of 3');
  });
});

const options = [
  { label: 'India', value: 'IN' },
  { label: 'Germany', value: 'DE' },
  { label: 'Singapore', value: 'SG', disabled: true },
];

describe('AppSelect', () => {
  const listbox = () => document.body.querySelector('[role="listbox"]');
  const optionEls = () => [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];

  it('opens a listbox, marks the selection and picks with the keyboard', async () => {
    const w = mount(AppSelect, { props: { label: 'Country', options, modelValue: 'IN' }, attachTo: document.body });
    const trigger = w.find('button[role="combobox"]');
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(trigger.text()).toContain('India');

    await trigger.trigger('keydown', { key: 'ArrowDown' });
    expect(trigger.attributes('aria-expanded')).toBe('true');
    expect(listbox()).not.toBeNull();
    expect(optionEls().find((o) => o.getAttribute('aria-selected') === 'true')?.textContent).toContain('India');

    await trigger.trigger('keydown', { key: 'ArrowDown' });
    await trigger.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('update:modelValue')![0]).toEqual(['DE']);
    expect(listbox()).toBeNull();
    w.unmount();
  });

  it('skips disabled options, closes on Escape and supports type-ahead', async () => {
    const w = mount(AppSelect, { props: { ariaLabel: 'Country', options, modelValue: 'DE' }, attachTo: document.body });
    const trigger = w.find('button[role="combobox"]');
    // Germany is selected; the only option below it (Singapore) is disabled, so ArrowDown stays put.
    await trigger.trigger('click');
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    expect(trigger.attributes('aria-activedescendant')).toMatch(/-1$/);
    await trigger.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('update:modelValue')).toBeUndefined();

    await trigger.trigger('click');
    await trigger.trigger('keydown', { key: 'i' });
    await trigger.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('update:modelValue')!.at(-1)).toEqual(['IN']);

    await trigger.trigger('click');
    await trigger.trigger('keydown', { key: 'Escape' });
    expect(listbox()).toBeNull();
    w.unmount();
  });

  it('filters long lists with the search box and offers the placeholder as "no value"', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ label: `Zone ${i + 1}`, value: `z${i + 1}` }));
    const w = mount(AppSelect, { props: { label: 'Time zone', options: many, placeholder: 'Any zone', modelValue: undefined }, attachTo: document.body });
    expect(w.find('button[role="combobox"]').text()).toContain('Any zone');
    await w.find('button[role="combobox"]').trigger('click');
    const search = document.body.querySelector<HTMLInputElement>('input[aria-label="Search Time zone"]')!;
    expect(optionEls()[0]!.textContent).toContain('Any zone');
    search.value = 'zone 12';
    search.dispatchEvent(new Event('input'));
    await w.vm.$nextTick();
    expect(optionEls().map((o) => o.textContent?.trim())).toEqual(['Zone 12']);
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(w.emitted('update:modelValue')![0]).toEqual(['z12']);
    w.unmount();
  });
});

describe('AppDatePicker', () => {
  it('opens a calendar, picks a day and clears the value', async () => {
    const w = mount(AppDatePicker, { props: { ariaLabel: 'From date', modelValue: '2026-03-15' }, attachTo: document.body });
    const trigger = w.find('button[aria-haspopup="dialog"]');
    expect(trigger.attributes('aria-label')).toContain('From date');
    await trigger.trigger('click');
    const grid = document.body.querySelector('[role="grid"]')!;
    expect(grid.getAttribute('aria-label')).toContain('2026');
    const selected = document.body.querySelector('[role="grid"] button[aria-selected="true"]')!;
    expect(selected.textContent?.trim()).toBe('15');

    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await w.vm.$nextTick();
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(w.emitted('update:modelValue')![0]).toEqual(['2026-03-16']);

    await w.setProps({ modelValue: '2026-03-16' });
    await w.find('button[aria-label="Clear From date"]').trigger('click');
    expect(w.emitted('update:modelValue')!.at(-1)).toEqual([undefined]);
    w.unmount();
  });

  it('disables days outside the min/max range', async () => {
    const w = mount(AppDatePicker, { props: { ariaLabel: 'To date', modelValue: '2026-03-15', min: '2026-03-10', max: '2026-03-20' }, attachTo: document.body });
    await w.find('button[aria-haspopup="dialog"]').trigger('click');
    const day = (n: number) => [...document.body.querySelectorAll<HTMLButtonElement>('[role="grid"] button')].find((b) => b.id.endsWith(`2026-03-${String(n).padStart(2, '0')}`))!;
    expect(day(9).disabled).toBe(true);
    expect(day(10).disabled).toBe(false);
    expect(day(21).disabled).toBe(true);
    w.unmount();
  });
});

describe('AppOtpInput', () => {
  it('fills boxes from a paste and moves back on Backspace', async () => {
    const w = mount(AppOtpInput, { props: { modelValue: '' } });
    const boxes = w.findAll('input');
    expect(boxes).toHaveLength(6);
    const paste = new Event('paste') as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '12 34-56' } });
    boxes[0]!.element.dispatchEvent(paste);
    expect(w.emitted('update:modelValue')![0]).toEqual(['123456']);

    await w.setProps({ modelValue: '12' });
    await boxes[2]!.trigger('keydown', { key: 'Backspace' });
    expect(w.emitted('update:modelValue')!.at(-1)).toEqual(['1']);
  });
});

describe('AppPasswordChecklist', () => {
  it('marks satisfied rules', () => {
    const w = mount(AppPasswordChecklist, { props: { password: 'abcdefghijkl', policy: DEFAULT_PASSWORD_POLICY } });
    const items = w.findAll('li');
    expect(items[0]!.text()).toContain('(met)');
    expect(w.text()).toContain('An uppercase letter (not met)');
  });
});
