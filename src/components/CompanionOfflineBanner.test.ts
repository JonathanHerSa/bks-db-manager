import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

const detectPlatform = vi.fn();
const openDownload = vi.fn();
const openUrl = vi.fn();

vi.mock('../services/companionInstall', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/companionInstall')>();
  return {
    ...actual,
    detectPlatform: (...a: any[]) => detectPlatform(...a),
    openDownload: (...a: any[]) => openDownload(...a),
    openUrl: (...a: any[]) => openUrl(...a)
  };
});

import CompanionOfflineBanner from './CompanionOfflineBanner.vue';

beforeEach(() => {
  vi.clearAllMocks();
  detectPlatform.mockReturnValue('linux-x64');
  openDownload.mockResolvedValue(undefined);
  openUrl.mockResolvedValue(undefined);
});

describe('CompanionOfflineBanner', () => {
  test('renders the reason clause when provided', () => {
    const wrapper = mount(CompanionOfflineBanner, { props: { reason: 'Docker y Auto-Discovery no pueden escanear' } });
    expect(wrapper.text()).toContain('El Companion Daemon no responde en el puerto 58765');
    expect(wrapper.text()).toContain('Docker y Auto-Discovery no pueden escanear');
  });

  test('omits the reason clause when not provided', () => {
    const wrapper = mount(CompanionOfflineBanner);
    expect(wrapper.text()).toContain('El Companion Daemon no responde en el puerto 58765.');
  });

  test('"Descargar Companion" downloads using the detected platform', async () => {
    const wrapper = mount(CompanionOfflineBanner);
    await wrapper.findAll('button').find((b) => b.text().includes('Descargar Companion'))!.trigger('click');
    expect(openDownload).toHaveBeenCalledWith('linux-x64');
  });

  test('"¿Otro sistema operativo?" reveals every platform as its own download button', async () => {
    const wrapper = mount(CompanionOfflineBanner);
    await wrapper.findAll('button').find((b) => b.text().includes('¿Otro sistema operativo?'))!.trigger('click');

    expect(wrapper.text()).toContain('macOS (Apple Silicon)');
    expect(wrapper.text()).toContain('macOS (Intel)');
    expect(wrapper.text()).toContain('Windows (x64)');
    expect(wrapper.text()).toContain('Linux (ARM64)');

    await wrapper.findAll('button').find((b) => b.text().includes('macOS (Intel)'))!.trigger('click');
    expect(openDownload).toHaveBeenCalledWith('darwin-x64');
  });

  test('emits "retry" when the Reintentar button is clicked', async () => {
    const wrapper = mount(CompanionOfflineBanner);
    await wrapper.findAll('button').find((b) => b.text().includes('Reintentar'))!.trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });

  test('"Cómo instalarlo" opens the docs URL', async () => {
    const wrapper = mount(CompanionOfflineBanner);
    await wrapper.find('a').trigger('click');
    expect(openUrl).toHaveBeenCalledTimes(1);
  });
});
