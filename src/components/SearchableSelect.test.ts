import { describe, it, expect, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import SearchableSelect from './SearchableSelect.vue'

let wrapper: VueWrapper<any> | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

function mountSelect(props: Partial<InstanceType<typeof SearchableSelect>['$props']> = {}) {
  wrapper = mount(SearchableSelect, {
    props: {
      modelValue: '',
      options: ['alpha', 'beta', 'gamma'],
      ...props
    },
    attachTo: document.body
  })
  return wrapper
}

describe('SearchableSelect', () => {
  it('shows the current modelValue in the input when closed', () => {
    mountSelect({ modelValue: 'beta' })
    const input = wrapper!.find('input')
    expect((input.element as HTMLInputElement).value).toBe('beta')
  })

  it('opens the dropdown and lists all options on focus', async () => {
    mountSelect()
    await wrapper!.find('input').trigger('focus')
    expect(wrapper!.text()).toContain('alpha')
    expect(wrapper!.text()).toContain('beta')
    expect(wrapper!.text()).toContain('gamma')
  })

  it('filters options case-insensitively while typing', async () => {
    mountSelect()
    const input = wrapper!.find('input')
    await input.trigger('focus')
    await input.setValue('BE')
    expect(wrapper!.text()).toContain('beta')
    expect(wrapper!.text()).not.toContain('alpha')
    expect(wrapper!.text()).not.toContain('gamma')
  })

  it('emits update:modelValue with free text while typing when allowCustom is true', async () => {
    mountSelect({ allowCustom: true })
    const input = wrapper!.find('input')
    await input.trigger('focus')
    await input.setValue('anything the user types')
    expect(wrapper!.emitted('update:modelValue')?.pop()).toEqual(['anything the user types'])
  })

  it('does NOT emit update:modelValue on free typing when allowCustom is false', async () => {
    mountSelect({ allowCustom: false })
    const input = wrapper!.find('input')
    await input.trigger('focus')
    await input.setValue('not a real option')
    expect(wrapper!.emitted('update:modelValue')).toBeUndefined()
  })

  it('emits update:modelValue and change when clicking an option', async () => {
    mountSelect()
    await wrapper!.find('input').trigger('focus')
    const optionEls = wrapper!.findAll('div').filter((n) => n.text() === 'beta')
    await optionEls[optionEls.length - 1].trigger('click')
    expect(wrapper!.emitted('update:modelValue')?.pop()).toEqual(['beta'])
    expect(wrapper!.emitted('change')?.pop()).toEqual(['beta'])
  })

  it('closes the dropdown after selecting an option', async () => {
    mountSelect()
    await wrapper!.find('input').trigger('focus')
    const optionEls = wrapper!.findAll('div').filter((n) => n.text() === 'alpha')
    await optionEls[optionEls.length - 1].trigger('click')
    expect(wrapper!.find('.absolute.left-0.right-0').exists()).toBe(false)
  })

  it('offers to use custom free text when no options match and allowCustom is true', async () => {
    mountSelect({ allowCustom: true })
    const input = wrapper!.find('input')
    await input.trigger('focus')
    await input.setValue('zzz-no-match')
    expect(wrapper!.text()).toContain('Usar "zzz-no-match"')
  })

  it('does not offer custom free text when allowCustom is false', async () => {
    mountSelect({ allowCustom: false })
    const input = wrapper!.find('input')
    await input.trigger('focus')
    await input.setValue('zzz-no-match')
    expect(wrapper!.text()).not.toContain('Usar "zzz-no-match"')
  })

  it('selects the highlighted option on Enter', async () => {
    mountSelect()
    const input = wrapper!.find('input')
    await input.trigger('focus')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper!.emitted('update:modelValue')?.pop()).toEqual(['beta'])
  })

  it('clears the selection when the clear button is clicked', async () => {
    mountSelect({ modelValue: 'alpha' })
    const clearBtn = wrapper!.find('button[title="Limpiar"]')
    expect(clearBtn.exists()).toBe(true)
    await clearBtn.trigger('click')
    expect(wrapper!.emitted('update:modelValue')?.pop()).toEqual([''])
    expect(wrapper!.emitted('change')?.pop()).toEqual([''])
  })

  it('does not show the clear button when there is no selection', () => {
    mountSelect({ modelValue: '' })
    expect(wrapper!.find('button[title="Limpiar"]').exists()).toBe(false)
  })

  it('closes the dropdown on Escape', async () => {
    mountSelect()
    const input = wrapper!.find('input')
    await input.trigger('focus')
    expect(wrapper!.find('.absolute.left-0.right-0').exists()).toBe(true)
    await input.trigger('keydown', { key: 'Escape' })
    expect(wrapper!.find('.absolute.left-0.right-0').exists()).toBe(false)
  })

  it('closes the dropdown when clicking outside the component', async () => {
    mountSelect()
    await wrapper!.find('input').trigger('focus')
    expect(wrapper!.find('.absolute.left-0.right-0').exists()).toBe(true)
    document.body.click()
    await wrapper!.vm.$nextTick()
    expect(wrapper!.find('.absolute.left-0.right-0').exists()).toBe(false)
  })

  it('ignores clicks and keyboard input when disabled', async () => {
    mountSelect({ disabled: true })
    expect(wrapper!.find('input').attributes('disabled')).toBeDefined()
  })
})
