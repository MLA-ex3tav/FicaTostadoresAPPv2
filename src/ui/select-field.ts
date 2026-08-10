export interface SelectFieldOption {
  value: string;
  label: string;
}

export interface SelectField {
  root: HTMLElement;
  getValue: () => string;
  setValue: (value: string, silent?: boolean) => void;
  setOptions: (options: SelectFieldOption[]) => void;
  destroy: () => void;
}

const CHEVRON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

const CHECK_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

interface SelectFieldConfig {
  options: SelectFieldOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
}

/**
 * Selector desplegable personalizado (catálogos / categorías). Reemplaza al
 * `<select>` nativo para tener un chevron propio y una lista con diseño.
 */
export function createSelectField(config: SelectFieldConfig): SelectField {
  const root = document.createElement("div");
  root.className = "custom-select";

  const valueEl = document.createElement("span");
  valueEl.className = "custom-select__value";

  const chevron = document.createElement("span");
  chevron.className = "custom-select__chevron";
  chevron.innerHTML = CHEVRON_SVG;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "custom-select__trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-label", config.ariaLabel);
  trigger.append(valueEl, chevron);

  const menu = document.createElement("div");
  menu.className = "custom-select__menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", config.ariaLabel);

  root.append(trigger, menu);

  const state = {
    value: config.value,
    options: config.options,
    open: false,
  };
  const placeholder = config.placeholder ?? "Seleccionar...";

  function render(): void {
    const current = state.options.find((option) => option.value === state.value);
    valueEl.textContent = current?.label ?? placeholder;
    valueEl.classList.toggle("is-placeholder", !current);

    menu.innerHTML = "";

    for (const option of state.options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `custom-select__option${
        option.value === state.value ? " is-selected" : ""
      }`;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(option.value === state.value));

      const label = document.createElement("span");
      label.className = "custom-select__option-label";
      label.textContent = option.label;
      button.append(label);

      if (option.value === state.value) {
        const check = document.createElement("span");
        check.className = "custom-select__option-check";
        check.innerHTML = CHECK_SVG;
        button.append(check);
      }

      button.addEventListener("click", () => {
        state.value = option.value;
        render();
        close();
        config.onChange(option.value);
      });

      menu.appendChild(button);
    }
  }

  function close(): void {
    state.open = false;
    root.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
  }

  function toggle(): void {
    state.open = !state.open;
    root.classList.toggle("is-open", state.open);
    trigger.setAttribute("aria-expanded", String(state.open));
  }

  trigger.addEventListener("click", toggle);

  const onDocClick = (event: MouseEvent): void => {
    if (!root.contains(event.target as Node)) {
      close();
    }
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      close();
    }
  };

  document.addEventListener("mousedown", onDocClick);
  document.addEventListener("keydown", onKey);

  render();

  return {
    root,
    getValue: () => state.value,
    setValue: (value, silent = false) => {
      state.value = value;
      render();
      if (!silent) {
        config.onChange(value);
      }
    },
    setOptions: (options) => {
      state.options = options;
      render();
    },
    destroy: () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      root.remove();
    },
  };
}
