import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { AUTHENTICATED_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY, PLATFORM_PERMISSIONS_KEY, REQUIRE_TENANT_KEY } from '../src/common/auth/decorators';
import { TestContext, createTestApp } from './helpers';

/**
 * Every API route must say who may call it — public, a permission, a platform permission, any member of the active
 * organization, or any signed-in user (own data only). A route that declares nothing would be open to every
 * signed-in user by default, so this test fails when one is added without a decision.
 */
describe('Route access declarations', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('declares access on every handler', () => {
    const keys = [IS_PUBLIC_KEY, PERMISSIONS_KEY, PLATFORM_PERMISSIONS_KEY, REQUIRE_TENANT_KEY, AUTHENTICATED_KEY];
    const undeclared: string[] = [];
    for (const module of ctx.app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const controller = wrapper.metatype as (new (...args: unknown[]) => unknown) | undefined;
        if (!controller?.prototype) continue;
        const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
        for (const name of Object.getOwnPropertyNames(controller.prototype)) {
          const handler = controller.prototype[name] as unknown;
          if (name === 'constructor' || typeof handler !== 'function') continue;
          const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
          if (path === undefined) continue;
          const declared = keys.some((k) => Reflect.getMetadata(k, handler) !== undefined || Reflect.getMetadata(k, controller) !== undefined);
          if (!declared) undeclared.push(`${RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number]} /${base}/${path} (${controller.name}.${name})`);
        }
      }
    }
    expect(undeclared).toEqual([]);
  });
});
