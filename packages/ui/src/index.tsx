"use client";

import { billingCadenceCatalog, cadencePrice, planCatalog } from "@waflo/billing";
import type { BillingCadence, Locale, PlanCode } from "@waflo/contracts";
import { AlertTriangle, Building2, Check, ChevronLeft, ChevronRight, Menu, X } from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost" | "destructive" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  loadingLabel?: string;
}

export function Button({
  variant = "primary",
  loading = false,
  loadingLabel = "Working…",
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`wf-button wf-button--${variant} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading ? <span className="wf-spinner" aria-hidden="true" /> : null}
      {loading ? loadingLabel : children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: ButtonVariant;
}

export function IconButton({
  label,
  variant = "ghost",
  className = "",
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`wf-icon-button wf-button--${variant} ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export function TextInput({ className = "", error = false, ...props }: InputProps) {
  return (
    <input
      className={`wf-input ${error ? "wf-input--error" : ""} ${className}`}
      aria-invalid={error || undefined}
      {...props}
    />
  );
}

export function EmailInput(props: InputProps) {
  return <TextInput type="email" autoComplete="email" inputMode="email" {...props} />;
}

export function PasswordInput(props: InputProps) {
  return <TextInput type="password" autoComplete="current-password" {...props} />;
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export function TextArea({ className = "", error = false, ...props }: TextAreaProps) {
  return (
    <textarea
      className={`wf-input wf-textarea ${error ? "wf-input--error" : ""} ${className}`}
      aria-invalid={error || undefined}
      {...props}
    />
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export function Select({ className = "", error = false, ...props }: SelectProps) {
  return (
    <select
      className={`wf-input wf-select ${error ? "wf-input--error" : ""} ${className}`}
      aria-invalid={error || undefined}
      {...props}
    />
  );
}

export interface SearchableSelectOption {
  value: string;
  label: string;
  group?: string;
}

export function SearchableSelect({
  name,
  options,
  value,
  defaultValue = "",
  placeholder,
  required = false,
  disabled = false,
  className = "",
  onValueChange,
  ariaLabel,
}: {
  name: string;
  options: readonly SearchableSelectOption[];
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  onValueChange?: (value: string) => void;
  ariaLabel?: string;
}) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const hasInteractedRef = useRef(false);
  const controlled = value !== undefined;
  const [selectedValue, setSelectedValue] = useState(value ?? defaultValue);
  const selected = options.find((option) => option.value === selectedValue) ?? null;
  const controlledLabel = options.find((option) => option.value === value)?.label ?? "";
  const [query, setQuery] = useState(selected?.label ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!controlled) return;
    setSelectedValue(value ?? "");
    setQuery(controlledLabel);
  }, [controlled, controlledLabel, value]);

  useEffect(() => {
    if (controlled || hasInteractedRef.current || selectedValue || !defaultValue) return;
    const defaultOption = options.find((option) => option.value === defaultValue);
    if (!defaultOption) return;
    setSelectedValue(defaultOption.value);
    setQuery(defaultOption.label);
  }, [controlled, defaultValue, options, selectedValue]);

  const filtered = useMemo(() => {
    const normalized = query.normalize("NFKC").trim().toLocaleLowerCase();
    if (!normalized) return options;
    return options.filter((option) =>
      `${option.label} ${option.value} ${option.group ?? ""}`
        .normalize("NFKC")
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [options, query]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  function choose(option: SearchableSelectOption) {
    hasInteractedRef.current = true;
    setSelectedValue(option.value);
    setQuery(option.label);
    setOpen(false);
    setActiveIndex(0);
    inputRef.current?.setCustomValidity("");
    onValueChange?.(option.value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, Math.max(0, filtered.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && open && filtered[activeIndex]) {
      event.preventDefault();
      choose(filtered[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery(selected?.label ?? "");
      setActiveIndex(0);
    }
  }

  return (
    <div className={`wf-search-select ${open ? "wf-search-select--open" : ""} ${className}`}>
      <input type="hidden" name={name} value={selectedValue} />
      <input
        ref={inputRef}
        type="search"
        className="wf-input wf-search-select__input"
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={
          open && filtered[activeIndex] ? `${listboxId}-${activeIndex}` : undefined
        }
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        required={required}
        disabled={disabled}
        onFocus={() => {
          // Clear the search query so all options are visible when the dropdown opens.
          // The selected value (selectedValue) is preserved; the label is restored on blur
          // if the user does not pick a different option.
          setQuery("");
          setOpen(true);
          setActiveIndex(0);
        }}
        onClick={() => {
          setQuery("");
          setOpen(true);
          setActiveIndex(0);
        }}
        onBlur={() => {
          setOpen(false);
          const exact = options.find(
            (option) =>
              option.value.toLocaleLowerCase() === query.trim().toLocaleLowerCase() ||
              option.label.toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
          );
          if (exact) choose(exact);
          else {
            setQuery(selected?.label ?? "");
            inputRef.current?.setCustomValidity(
              required && !selectedValue ? "Choose an option." : "",
            );
          }
        }}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          hasInteractedRef.current = true;
          setQuery(event.currentTarget.value);
          setSelectedValue("");
          event.currentTarget.setCustomValidity(required ? "Choose a listed option." : "");
          setActiveIndex(0);
          setOpen(true);
        }}
      />
      {open ? (
        <div className="wf-search-select__list" id={listboxId} role="listbox">
          {filtered.length ? (
            filtered.map((option, index) => {
              const previousGroup = filtered[index - 1]?.group;
              return (
                <div key={option.value}>
                  {option.group && option.group !== previousGroup ? (
                    <div className="wf-search-select__group" aria-hidden="true">
                      {option.group}
                    </div>
                  ) : null}
                  <button
                    id={`${listboxId}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={option.value === selectedValue}
                    className="wf-search-select__option"
                    data-active={index === activeIndex || undefined}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => choose(option)}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span>{option.label}</span>
                    <small dir="ltr">{option.value}</small>
                  </button>
                </div>
              );
            })
          ) : (
            <div className="wf-search-select__empty">No matching option</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ColorInput({
  className = "",
  value,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const color = typeof value === "string" ? value : "#000000";
  return (
    <div className={`wf-color-input ${className}`}>
      <input type="color" value={color} {...props} />
      <span
        className="wf-color-input__swatch"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <code>{color.toLocaleUpperCase("en-US")}</code>
      <span className="wf-color-input__action" aria-hidden="true">
        Edit
      </span>
    </div>
  );
}

export function Checkbox({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  const id = useId();
  return (
    <label className="wf-check" htmlFor={props.id ?? id}>
      <input id={props.id ?? id} type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}

export function RadioGroup({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: readonly { value: string; label: string; description?: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="wf-radio-group">
      <legend>{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="wf-radio-card">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>
            <strong>{option.label}</strong>
            {option.description ? <small>{option.description}</small> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function FormField({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: This wrapper always receives its form control as children.
    <label className="wf-field">
      <span className="wf-field__label">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </span>
      {children}
      {error ? <FormError>{error}</FormError> : hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <span className="wf-form-error" role="alert">
      {children}
    </span>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "brand" | "success" | "warning" | "danger";
  children: ReactNode;
}) {
  return <span className={`wf-badge wf-badge--${tone}`}>{children}</span>;
}

export function StatusBadge({
  status,
  label,
}: {
  status: "pending" | "active" | "suspended" | "archived" | "canceled";
  label: string;
}) {
  const tone =
    status === "active"
      ? "success"
      : status === "pending"
        ? "warning"
        : status === "suspended" || status === "canceled"
          ? "danger"
          : "neutral";
  return <Badge tone={tone}>{label}</Badge>;
}

export function Avatar({ name, imageUrl }: { name: string; imageUrl?: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase();
  return imageUrl ? (
    <img className="wf-avatar" src={imageUrl} alt="" />
  ) : (
    <span className="wf-avatar" role="img" aria-label={name}>
      {initials}
    </span>
  );
}

export function Card({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`wf-card ${className}`} {...props}>
      {children}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={`wf-alert wf-alert--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      {tone === "warning" || tone === "danger" ? (
        <AlertTriangle size={20} aria-hidden="true" />
      ) : (
        <Check size={20} aria-hidden="true" />
      )}
      <div>
        <strong>{title}</strong>
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}

export function Modal({
  open,
  title,
  children,
  onClose,
  closeLabel = "Close",
  className = "",
  description,
  descriptionVisible = false,
  locked = false,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  closeLabel?: string;
  className?: string;
  description?: string;
  descriptionVisible?: boolean;
  locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      requestAnimationFrame(() => dialog.focus());
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousDocumentOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [open]);

  function restoreFocus() {
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target?.isConnected) requestAnimationFrame(() => target.focus());
  }
  return (
    <dialog
      ref={ref}
      className={`wf-dialog ${className}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={locked}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const dialog = ref.current;
        if (!dialog) return;
        const focusable = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => !element.hasAttribute("hidden"));
        if (!focusable.length) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === dialog || document.activeElement === first)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === dialog || document.activeElement === last)
        ) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!locked) onClose();
      }}
      onClose={(event) => {
        event.stopPropagation();
        restoreFocus();
      }}
    >
      <div className="wf-dialog__header">
        <h2 id={titleId}>{title}</h2>
        <IconButton label={closeLabel} onClick={onClose} disabled={locked}>
          <X size={20} />
        </IconButton>
      </div>
      <div className="wf-dialog__body">
        {description ? (
          <p
            className={descriptionVisible ? "wf-dialog__description" : "wf-sr-only"}
            id={descriptionId}
          >
            {description}
          </p>
        ) : null}
        {children}
      </div>
    </dialog>
  );
}

export function AlertDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  closeLabel = "Close",
  danger = false,
  loading = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  closeLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      description={description}
      descriptionVisible
      closeLabel={closeLabel}
      locked={loading}
      onClose={onClose}
    >
      <div className="wf-dialog__actions">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          onClick={onConfirm}
          disabled={loading}
          loading={loading}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export const ConfirmationDialog = AlertDialog;

export function Toast({
  tone = "success",
  children,
}: {
  tone?: "success" | "danger";
  children: ReactNode;
}) {
  return (
    <div className={`wf-toast wf-toast--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function DropdownMenu({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <details className="wf-dropdown">
      <summary>{label}</summary>
      <div className="wf-dropdown__menu">{children}</div>
    </details>
  );
}

export function Tabs({
  tabs,
  initial,
}: {
  tabs: readonly { id: string; label: string; content: ReactNode }[];
  initial?: string;
}) {
  const [selected, setSelected] = useState(initial ?? tabs[0]?.id ?? "");
  const active = tabs.find((tab) => tab.id === selected);
  return (
    <div className="wf-tabs">
      <div role="tablist" className="wf-tabs__list">
        {tabs.map((tab) => (
          <button
            type="button"
            role="tab"
            aria-selected={selected === tab.id}
            key={tab.id}
            onClick={() => setSelected(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="wf-tabs__panel">
        {active?.content}
      </div>
    </div>
  );
}

export function Table({
  headers,
  rows,
  caption,
  className = "",
}: {
  headers: readonly string[];
  rows: readonly (readonly ReactNode[])[];
  caption: string;
  className?: string;
}) {
  return (
    <div className={`wf-table-wrap ${className}`}>
      <table className="wf-table">
        <caption className="wf-sr-only">{caption}</caption>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex.toString()}`}>
              {row.map((cell, cellIndex) => (
                <td key={`cell-${cellIndex.toString()}`} data-label={headers[cellIndex]}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="wf-empty">
      {icon ? <div className="wf-empty__icon">{icon}</div> : null}
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function Skeleton({ width = "100%", height = "1rem" }: { width?: string; height?: string }) {
  return <span className="wf-skeleton" style={{ width, height }} aria-hidden="true" />;
}

export function Pagination({
  previousLabel,
  nextLabel,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: {
  previousLabel: string;
  nextLabel: string;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <nav className="wf-pagination" aria-label="Pagination">
      <Button variant="secondary" disabled={!hasPrevious} onClick={onPrevious}>
        <ChevronLeft size={16} aria-hidden="true" />
        {previousLabel}
      </Button>
      <Button variant="secondary" disabled={!hasNext} onClick={onNext}>
        {nextLabel}
        <ChevronRight size={16} aria-hidden="true" />
      </Button>
    </nav>
  );
}

export function Sidebar({
  logo,
  organization,
  navigation,
  footer,
}: {
  logo: ReactNode;
  organization: ReactNode;
  navigation: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <aside className="wf-sidebar">
      <div className="wf-sidebar__logo">{logo}</div>
      {organization}
      <nav className="wf-sidebar__nav">{navigation}</nav>
      {footer ? <div className="wf-sidebar__footer">{footer}</div> : null}
    </aside>
  );
}

export function TopNavigation({ title, actions }: { title: string; actions: ReactNode }) {
  return (
    <header className="wf-topnav">
      <span className="wf-topnav__title">{title}</span>
      <div className="wf-topnav__actions">{actions}</div>
    </header>
  );
}

export function MobileNavigation({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="wf-mobile-nav">
      <IconButton label={label} onClick={() => setOpen((value) => !value)}>
        {open ? <X /> : <Menu />}
      </IconButton>
      {open ? <nav>{children}</nav> : null}
    </div>
  );
}

export function Breadcrumb({ items }: { items: readonly { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="wf-breadcrumb">
        {items.map((item, index) => (
          <li key={`${item.label}-${index.toString()}`}>
            {item.href ? <a href={item.href}>{item.label}</a> : <span>{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function LanguageSwitcher({ locale, href }: { locale: Locale; href: string }) {
  return (
    <a className="wf-language-switcher" href={href} lang={locale === "ar" ? "en" : "ar"}>
      {locale === "ar" ? "English" : "العربية"}
    </a>
  );
}

export function OrganizationSwitcher({
  label,
  organizations,
  value,
  onChange,
}: {
  label: string;
  organizations: readonly { id: string; name: string }[];
  value: string;
  onChange: (organizationId: string) => void;
}) {
  const selected = organizations.find((organization) => organization.id === value);
  const [open, setOpen] = useState(false);
  return (
    <div className="wf-org-switcher">
      <button
        type="button"
        className="wf-org-switcher__trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Building2 size={18} strokeWidth={1.75} aria-hidden="true" />
        <span>{selected?.name ?? label}</span>
        <ChevronRight className="wf-org-switcher__chevron" size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className="wf-org-switcher__menu" role="listbox" aria-label={label}>
          {organizations.map((organization) => (
            <button
              key={organization.id}
              type="button"
              role="option"
              aria-selected={organization.id === value}
              onClick={() => {
                onChange(organization.id);
                setOpen(false);
              }}
            >
              <span>{organization.name}</span>
              {organization.id === value ? <Check size={16} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PlanCard({
  plan,
  selected,
  locale,
  cadence = "monthly",
  onSelect,
}: {
  plan: PlanCode;
  selected: boolean;
  locale: Locale;
  cadence?: BillingCadence;
  onSelect?: (plan: PlanCode) => void;
}) {
  const definition = planCatalog[plan];
  const pricing = cadencePrice(plan, cadence);
  const cadenceDefinition = billingCadenceCatalog[cadence];
  const copy = locale === "ar";
  const cadenceLabel = copy
    ? cadence === "monthly"
      ? "شهري"
      : cadence === "quarterly"
        ? "كل ثلاثة أشهر"
        : "سنوي"
    : cadenceDefinition.label;
  const discountLabel = cadence === "quarterly" ? "8.33%" : cadence === "yearly" ? "16.67%" : "";
  const savings = pricing.undiscountedAmountUsd - pricing.billedAmountUsd;
  const count = (value: number | null, singular: string, plural: string, unboundedLabel: string) =>
    value === null ? unboundedLabel : `${value} ${value === 1 ? singular : plural}`;
  const benefits = [
    count(
      definition.limits.programs,
      copy ? "بطاقة ولاء نشطة" : "active loyalty card",
      copy ? "بطاقات ولاء نشطة" : "active loyalty cards",
      copy ? "بطاقات ولاء نشطة غير محدودة" : "Unlimited active loyalty cards",
    ),
    count(
      definition.limits.locations,
      copy ? "موقع" : "location",
      copy ? "مواقع" : "locations",
      copy ? "حد مواقع Scale قابل للضبط" : "Configurable Scale location limit",
    ),
    count(
      definition.limits.teamSeats,
      copy ? "مقعد مدير أو موظف" : "Manager or Staff seat",
      copy ? "مقاعد للمديرين والموظفين" : "Manager and Staff seats",
      copy ? "حد مقاعد Scale قابل للضبط" : "Configurable Scale Manager and Staff limit",
    ),
    definition.features.advancedExports
      ? copy
        ? "تخصيص وتحليلات وتصدير متقدم"
        : "Advanced customization, analytics, and exports"
      : definition.features.advancedAnalytics
        ? copy
          ? "تخصيص وتحليلات متقدمة"
          : "Advanced customization and analytics"
        : copy
          ? "التحليلات الأساسية"
          : "Essential analytics",
  ];
  return (
    <Card className={`wf-plan-card ${selected ? "wf-plan-card--selected" : ""}`}>
      <div className="wf-plan-card__heading">
        <h3>
          <bdi dir="ltr">{definition.name}</bdi>
        </h3>
        {selected ? <Badge tone="brand">{copy ? "الخطة المختارة" : "Selected"}</Badge> : null}
      </div>
      <p className="wf-plan-card__price">
        <bdi dir="ltr">${pricing.billedAmountUsd.toFixed(2)}</bdi>
        <span>/{copy ? cadenceLabel : cadenceDefinition.label.toLocaleLowerCase("en-US")}</span>
      </p>
      <small className="wf-plan-card__cadence">
        {copy ? "وتيرة الفوترة:" : "Billing cadence:"} {cadenceLabel}
      </small>
      {cadenceDefinition.discountRate ? (
        <small className="wf-plan-card__equivalent">
          <bdi dir="ltr">${pricing.monthlyEquivalentUsd.toFixed(2)}</bdi>/{copy ? "شهر" : "month"} ·{" "}
          {cadence === "yearly" ? (copy ? "شهران مجاناً" : "2 months free") : null}
          {cadence === "yearly" ? " · " : null}
          {copy ? "وفّر" : "Save"} <bdi dir="ltr">${savings.toFixed(2)}</bdi> ({discountLabel})
        </small>
      ) : null}
      <ul className="wf-plan-card__benefits">
        {benefits.map((benefit) => (
          <li key={benefit}>
            <Check size={16} aria-hidden="true" />
            <span>{benefit}</span>
          </li>
        ))}
      </ul>
      {onSelect ? (
        <Button
          variant={selected ? "secondary" : "primary"}
          onClick={() => onSelect(plan)}
          disabled={selected}
        >
          {selected ? (copy ? "محددة" : "Selected") : copy ? "اختيار الخطة" : "Choose plan"}
        </Button>
      ) : null}
    </Card>
  );
}

export function UsageMeter({
  label,
  current,
  limit,
  unlimitedLabel,
}: {
  label: string;
  current: number;
  limit: number | null;
  unlimitedLabel?: string;
}) {
  const percentage = limit === null ? 0 : Math.min(100, Math.round((current / limit) * 100));
  return (
    <div className="wf-usage">
      <div>
        <span>{label}</span>
        <strong>
          {limit === null ? (unlimitedLabel ?? `${current} · Unlimited`) : `${current} / ${limit}`}
        </strong>
      </div>
      {limit === null ? null : <progress max={100} value={percentage} aria-label={label} />}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="wf-page-header">
      <div>
        {eyebrow ? <span className="wf-eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="wf-page-header__actions">{actions}</div> : null}
    </div>
  );
}
