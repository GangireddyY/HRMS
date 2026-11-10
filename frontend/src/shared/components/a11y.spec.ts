import { mount } from '@vue/test-utils';
import axe from 'axe-core';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import AppDataTable from '@/shared/components/data/AppDataTable.vue';
import AppSavedViews from '@/shared/components/data/AppSavedViews.vue';
import AppAlert from '@/shared/components/feedback/AppAlert.vue';
import AppDatePicker from '@/shared/components/forms/AppDatePicker.vue';
import AppInput from '@/shared/components/forms/AppInput.vue';
import AppSelect from '@/shared/components/forms/AppSelect.vue';
import AppDropdown from '@/shared/components/layout/AppDropdown.vue';
import type { TableColumn } from '@/shared/components/types';

/**
 * Automated accessibility checks (axe-core) on the shared building blocks every page uses. jsdom has no layout, so
 * colour contrast is checked in the browser suite instead.
 */
async function violations(el: Element) {
  const result = await axe.run(el, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
}

const mounted: { unmount: () => void }[] = [];
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  document.body.innerHTML = '';
});
function render<T>(component: T, options: Record<string, unknown>) {
  const w = mount(component as never, { attachTo: document.body, ...options });
  mounted.push(w);
  return w;
}

describe('accessibility of shared components', () => {
  it('data table with sorting, selection, export and column chooser', async () => {
    const columns: TableColumn<{ id: string; name: string; dept: string }>[] = [
      { key: 'name', label: 'Name', sortField: 'name' },
      { key: 'dept', label: 'Department' },
    ];
    const w = render(AppDataTable, {
      props: { columns, rows: [{ id: '1', name: 'Asha', dept: 'Eng' }, { id: '2', name: 'Ravi', dept: 'Sales' }], caption: 'People', selectable: true, selectLabel: (r: { name: string }) => `Select ${r.name}`, exportFile: 'people', columnChooser: true, grid: false, sort: 'name:asc' },
    });
    expect(await violations(w.element)).toEqual([]);
  });

  it('form fields: input, select and date picker with labels and errors', async () => {
    const w = render(
      {
        components: { AppInput, AppSelect, AppDatePicker },
        template: `<form>
          <AppInput label="First name" model-value="" required error="Enter a first name" />
          <AppSelect label="Department" :options="[{ value: 'e', label: 'Engineering' }]" :model-value="null" />
          <AppDatePicker label="Joining date" />
        </form>`,
      },
      {},
    );
    expect(await violations(w.element)).toEqual([]);
  });

  it('menus and saved views', async () => {
    const w = render(
      {
        components: { AppDropdown, AppSavedViews },
        template: `<div>
          <AppDropdown label="Actions"><template #trigger="{ toggle }"><button type="button" @click="toggle">More</button></template><button type="button">Edit</button></AppDropdown>
          <AppSavedViews :views="[{ name: 'Engineering', search: '', filters: {} }]" :can-save="true" />
        </div>`,
      },
      {},
    );
    await w.find('button').trigger('click');
    await nextTick();
    expect(await violations(w.element)).toEqual([]);
  });

  it('alerts', async () => {
    const w = render(AppAlert, { props: { tone: 'warning', title: 'Part of the dashboard did not load' }, slots: { default: 'Try again.' } });
    expect(await violations(w.element)).toEqual([]);
  });
});
