<template>
  <div class="relative w-full" ref="containerRef">
    <!-- Input with icons -->
    <div class="relative flex items-center">
      <input
        ref="inputRef"
        type="text"
        :value="displayValue"
        @input="onInput"
        @focus="onFocus"
        @keydown="onKeyDown"
        :placeholder="placeholder"
        :disabled="disabled"
        autocomplete="off"
        spellcheck="false"
        class="w-full bg-slate-950 border border-white/[0.1] rounded-lg pl-3 pr-14 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition cursor-text placeholder:text-slate-500"
      />
      <div class="absolute right-2.5 flex items-center gap-1 text-slate-400">
        <button
          v-if="modelValue"
          @click.stop="clearSelection"
          type="button"
          class="hover:text-white p-1 rounded cursor-pointer transition text-slate-500 hover:text-slate-300"
          title="Limpiar"
        >
          <X class="w-3.5 h-3.5" />
        </button>
        <button
          @click.stop="toggleDropdown"
          type="button"
          class="hover:text-white p-1 rounded cursor-pointer transition text-slate-400"
          tabindex="-1"
          title="Desplegar lista"
        >
          <ChevronDown
            class="w-3.5 h-3.5 transition-transform duration-200"
            :class="isOpen ? 'rotate-180 text-sky-400' : ''"
          />
        </button>
      </div>
    </div>

    <!-- Floating Dropdown Overlay -->
    <transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="transform scale-95 opacity-0"
      enter-to-class="transform scale-100 opacity-100"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="transform scale-100 opacity-100"
      leave-to-class="transform scale-95 opacity-0"
    >
      <div
        v-if="isOpen"
        class="absolute left-0 right-0 z-50 mt-1 bg-slate-900 border border-white/[0.12] rounded-lg shadow-2xl overflow-hidden backdrop-blur-md"
      >
        <!-- Info Header -->
        <div
          v-if="options.length > 0"
          class="px-3 py-1.5 bg-slate-950/80 border-b border-white/[0.06] text-[10px] font-mono text-slate-400 flex items-center justify-between select-none"
        >
          <span>{{ filteredOptions.length }} de {{ options.length }} bases de datos</span>
          <span v-if="searchQuery" class="text-sky-400 truncate max-w-[150px]">Filtro: "{{ searchQuery }}"</span>
        </div>

        <!-- Options list -->
        <div
          ref="listRef"
          class="max-h-56 overflow-y-auto p-1 space-y-0.5 scrollbar-thin scrollbar-thumb-slate-700"
        >
          <div
            v-for="(option, idx) in filteredOptions"
            :key="option"
            :ref="(el) => setOptionRef(el, idx)"
            @click="selectOption(option)"
            :class="[
              idx === activeIndex
                ? 'bg-sky-500/20 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white',
              option === modelValue ? 'bg-sky-500/10 text-sky-300 font-medium' : ''
            ]"
            class="px-3 py-1.5 rounded text-xs font-mono flex items-center justify-between cursor-pointer transition select-none"
          >
            <span class="truncate">{{ option }}</span>
            <Check v-if="option === modelValue" class="w-3.5 h-3.5 text-sky-400 shrink-0 ml-2" />
          </div>

          <!-- Empty list state -->
          <div v-if="filteredOptions.length === 0" class="px-3 py-4 text-center text-xs text-slate-500 font-mono">
            <div>{{ emptyText }}</div>
            <div v-if="allowCustom && searchQuery" class="mt-2">
              <button
                @click="selectOption(searchQuery)"
                type="button"
                class="px-2.5 py-1 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 rounded text-xs cursor-pointer border border-sky-500/30 transition"
              >
                Usar "{{ searchQuery }}"
              </button>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { ChevronDown, Check, X } from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: string[];
    placeholder?: string;
    disabled?: boolean;
    allowCustom?: boolean;
    emptyText?: string;
  }>(),
  {
    placeholder: 'Buscar o escribir base de datos...',
    disabled: false,
    allowCustom: true,
    emptyText: 'No se encontraron bases de datos'
  }
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'change', value: string): void;
}>();

const containerRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const optionRefs = ref<HTMLElement[]>([]);

const isOpen = ref(false);
const searchQuery = ref('');
const activeIndex = ref(-1);

function setOptionRef(el: any, idx: number) {
  if (el) {
    optionRefs.value[idx] = el as HTMLElement;
  }
}

// Display value: show search query while typing/searching, otherwise current modelValue
const displayValue = computed(() => {
  if (isOpen.value) {
    return searchQuery.value;
  }
  return props.modelValue || '';
});

// Filtered options based on case-insensitive search
const filteredOptions = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) {
    return props.options;
  }
  return props.options.filter((opt) => opt.toLowerCase().includes(q));
});

function onInput(e: Event) {
  const val = (e.target as HTMLInputElement).value;
  searchQuery.value = val;
  if (!isOpen.value) {
    isOpen.value = true;
  }
  activeIndex.value = 0;
  if (props.allowCustom) {
    emit('update:modelValue', val);
  }
}

function onFocus() {
  searchQuery.value = props.modelValue || '';
  isOpen.value = true;
  activeIndex.value = Math.max(0, filteredOptions.value.indexOf(props.modelValue));
  nextTick(() => {
    inputRef.value?.select();
    scrollToActive();
  });
}

function toggleDropdown() {
  if (props.disabled) return;
  if (isOpen.value) {
    closeDropdown();
  } else {
    inputRef.value?.focus();
  }
}

function closeDropdown() {
  isOpen.value = false;
  searchQuery.value = '';
  activeIndex.value = -1;
}

function selectOption(option: string) {
  emit('update:modelValue', option);
  emit('change', option);
  closeDropdown();
}

function clearSelection() {
  emit('update:modelValue', '');
  emit('change', '');
  searchQuery.value = '';
  nextTick(() => {
    inputRef.value?.focus();
  });
}

function onKeyDown(e: KeyboardEvent) {
  if (!isOpen.value) {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      onFocus();
    }
    return;
  }

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      if (filteredOptions.value.length > 0) {
        activeIndex.value = (activeIndex.value + 1) % filteredOptions.value.length;
        scrollToActive();
      }
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (filteredOptions.value.length > 0) {
        activeIndex.value =
          (activeIndex.value - 1 + filteredOptions.value.length) % filteredOptions.value.length;
        scrollToActive();
      }
      break;
    case 'Enter':
      e.preventDefault();
      if (activeIndex.value >= 0 && activeIndex.value < filteredOptions.value.length) {
        selectOption(filteredOptions.value[activeIndex.value]);
      } else if (props.allowCustom && searchQuery.value.trim()) {
        selectOption(searchQuery.value.trim());
      }
      break;
    case 'Escape':
      e.preventDefault();
      closeDropdown();
      inputRef.value?.blur();
      break;
    case 'Tab':
      closeDropdown();
      break;
  }
}

function scrollToActive() {
  nextTick(() => {
    const el = optionRefs.value[activeIndex.value];
    if (el && listRef.value) {
      el.scrollIntoView({ block: 'nearest' });
    }
  });
}

// Global click outside listener
function handleClickOutside(e: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(e.target as Node)) {
    closeDropdown();
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside);
});

watch(
  () => props.options,
  () => {
    optionRefs.value = [];
  }
);
</script>
