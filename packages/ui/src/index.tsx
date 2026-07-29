"use client";

import { planCatalog } from "@waflo/billing";
import type { Locale, PlanCode } from "@waflo/contracts";
import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { AlertTriangle, Building2, Check, ChevronLeft, ChevronRight, Menu, X } from "lucide-react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

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
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="wf-dialog"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClose={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="wf-dialog__header">
        <h2>{title}</h2>
        <IconButton label="Close" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}

export function AlertDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <p>{description}</p>
      <div className="wf-dialog__actions">
        <Button variant="secondary" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
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
}: {
  headers: readonly string[];
  rows: readonly (readonly ReactNode[])[];
  caption: string;
}) {
  return (
    <div className="wf-table-wrap">
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
                <td key={`cell-${cellIndex.toString()}`}>{cell}</td>
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
      <h1>{title}</h1>
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
  return (
    <label className="wf-org-switcher">
      <span className="wf-sr-only">{label}</span>
      <Building2 size={18} aria-hidden="true" />
      <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>
            {organization.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PlanCard({
  plan,
  selected,
  locale,
  onSelect,
}: {
  plan: PlanCode;
  selected: boolean;
  locale: Locale;
  onSelect?: (plan: PlanCode) => void;
}) {
  const definition = planCatalog[plan];
  const copy = locale === "ar";
  return (
    <Card className={`wf-plan-card ${selected ? "wf-plan-card--selected" : ""}`}>
      <div className="wf-plan-card__heading">
        <h3>{definition.name}</h3>
        {selected ? <Badge tone="brand">{copy ? "الخطة المختارة" : "Selected"}</Badge> : null}
      </div>
      <p className="wf-plan-card__price">
        ${definition.monthlyPriceUsd}
        <span>/{copy ? "شهرياً" : "month"}</span>
      </p>
      <ul>
        <li>
          {definition.limits.locations ?? (copy ? "حد مرن" : "Configurable")}{" "}
          {copy ? "مواقع" : "locations"}
        </li>
        <li>
          {definition.limits.teamSeats ?? (copy ? "حد مرن" : "Configurable")}{" "}
          {copy ? "مقاعد فريق" : "team seats"}
        </li>
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
}: {
  label: string;
  current: number;
  limit: number | null;
}) {
  const percentage = limit === null ? 0 : Math.min(100, Math.round((current / limit) * 100));
  return (
    <div className="wf-usage">
      <div>
        <span>{label}</span>
        <strong>
          {current} / {limit ?? "∞"}
        </strong>
      </div>
      <progress max={100} value={percentage} aria-label={label} />
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
