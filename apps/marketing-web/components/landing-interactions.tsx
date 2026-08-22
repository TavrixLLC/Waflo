"use client";

import { Check, QrCode, ShieldCheck, Store, UsersRound, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MarketingCopy } from "../lib/marketing-copy";

const STAMPS = [0, 1, 2, 3, 4, 5] as const;

type PassCopy = MarketingCopy["pass"];

function LoyaltyPass({
  copy,
  filled = 4,
  reward,
  goal,
  compact = false,
}: {
  copy: PassCopy;
  filled?: number;
  reward?: string;
  goal?: string;
  compact?: boolean;
}) {
  const ready = filled >= STAMPS.length;
  return (
    <article
      className={`landing-pass${compact ? " landing-pass--compact" : ""}${ready ? " is-ready" : ""}`}
      aria-label={copy.label}
    >
      <div className="landing-pass__head">
        <span className="landing-pass__mark" aria-hidden="true">
          W
        </span>
        <div className="landing-pass__title">
          <small>{copy.program}</small>
          <strong>{copy.merchant}</strong>
        </div>
        {ready ? <span className="landing-pass__ready">{copy.rewardReady}</span> : null}
      </div>
      <div className="landing-pass__stamps" aria-hidden="true">
        {STAMPS.map((stamp) => (
          <span className={stamp < filled ? "is-filled" : ""} key={stamp}>
            {stamp < filled ? <Check size={15} strokeWidth={2.4} /> : null}
          </span>
        ))}
      </div>
      <div className="landing-pass__meta">
        <strong>{goal ?? `${Math.min(filled, STAMPS.length)}/6 · ${reward ?? copy.reward}`}</strong>
        <small>today.waflo.app</small>
      </div>
      <div className="landing-pass__foot">
        <span>
          <Wallet size={14} aria-hidden="true" /> {copy.addToWallet}
        </span>
        <span>{copy.history}</span>
      </div>
    </article>
  );
}

export function HeroJourney({ copy }: { copy: MarketingCopy }) {
  const [stage, setStage] = useState(1);
  const filled = [2, 4, 6][stage] ?? 4;

  return (
    <div className="landing-hero-demo" data-stage={stage}>
      <p className="landing-demo-label">{copy.pass.label}</p>
      <div className="landing-hero-demo__canvas">
        <div className="landing-phone" aria-hidden="true">
          <span />
          <small>{copy.hero.stages[1]}</small>
        </div>
        <div className="landing-hero-demo__pass">
          <LoyaltyPass copy={copy.pass} filled={filled} />
        </div>
        <span className="landing-scan-cue">
          <QrCode size={16} aria-hidden="true" /> {copy.pass.staffScans}
        </span>
      </div>
      <fieldset className="landing-stage-control">
        <legend className="landing-control-label">{copy.hero.eyebrow}</legend>
        {copy.hero.stages.map((label, index) => (
          <button
            type="button"
            key={label}
            aria-pressed={stage === index}
            onClick={() => setStage(index)}
          >
            <span aria-hidden="true">{index + 1}</span>
            {label}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

export function FlowStory({ copy }: { copy: MarketingCopy }) {
  const [active, setActive] = useState(0);
  const stepRefs = useRef<Array<HTMLElement | null>>([]);
  const fills = [1, 2, 4, 6, 1] as const;

  useEffect(() => {
    const nodes = stepRefs.current.filter((node): node is HTMLElement => node !== null);
    if (!nodes.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((first, second) => second.intersectionRatio - first.intersectionRatio)[0];
        if (!visible) return;
        const index = Number((visible.target as HTMLElement).dataset.flowIndex);
        if (Number.isInteger(index)) setActive(index);
      },
      { rootMargin: "-35% 0px -35% 0px", threshold: [0.1, 0.45, 0.75] },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="landing-flow-story">
      <ol className="landing-flow-story__steps">
        {copy.flow.steps.map((step, index) => (
          <li key={step.title}>
            <article
              ref={(element) => {
                stepRefs.current[index] = element;
              }}
              data-flow-index={index}
              data-active={active === index ? "true" : "false"}
            >
              <span className="landing-flow-story__number">
                <bdi dir="ltr">{String(index + 1).padStart(2, "0")}</bdi>
              </span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </article>
          </li>
        ))}
      </ol>
      <div className="landing-flow-story__sticky" aria-live="polite">
        <div className="landing-flow-orbit" aria-hidden="true">
          <span>{copy.hero.stages[0]}</span>
          <span>{copy.hero.stages[1]}</span>
          <span>{copy.hero.stages[2]}</span>
        </div>
        <LoyaltyPass copy={copy.pass} filled={fills[active] ?? 1} />
        <p>
          <span>{String(active + 1).padStart(2, "0")}</span>
          {copy.flow.steps[active]?.title}
        </p>
      </div>
    </div>
  );
}

export function WalletDemo({ copy }: { copy: MarketingCopy }) {
  const [platform, setPlatform] = useState<"apple" | "google">("apple");
  return (
    <div className="landing-wallet-demo">
      <fieldset className="landing-wallet-demo__switch">
        <legend className="landing-control-label">{copy.wallet.previewLabel}</legend>
        <button
          type="button"
          aria-pressed={platform === "apple"}
          onClick={() => setPlatform("apple")}
        >
          <span aria-hidden="true">●</span> {copy.wallet.apple}
        </button>
        <button
          type="button"
          aria-pressed={platform === "google"}
          onClick={() => setPlatform("google")}
        >
          <span className="landing-google-mark" aria-hidden="true" /> {copy.wallet.google}
        </button>
      </fieldset>
      <div className="landing-wallet-demo__device" data-wallet={platform}>
        <div className="landing-wallet-demo__bar">
          <span>{platform === "apple" ? copy.wallet.apple : copy.wallet.google}</span>
          <span aria-hidden="true">•••</span>
        </div>
        <LoyaltyPass copy={copy.pass} filled={4} compact />
        <div className="landing-wallet-demo__status">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>{copy.wallet.points[1]?.title}</span>
        </div>
      </div>
    </div>
  );
}

export function SidesExplorer({ copy }: { copy: MarketingCopy }) {
  const [side, setSide] = useState<"customer" | "merchant">("customer");
  const selected = side === "customer" ? copy.sides.customer : copy.sides.merchant;
  return (
    <div className="landing-sides-explorer">
      <fieldset className="landing-sides-explorer__tabs">
        <legend className="landing-control-label">{copy.sides.eyebrow}</legend>
        {(["customer", "merchant"] as const).map((value) => {
          const item = value === "customer" ? copy.sides.customer : copy.sides.merchant;
          return (
            <button
              type="button"
              key={value}
              aria-pressed={side === value}
              onClick={() => setSide(value)}
            >
              {value === "customer" ? <Wallet size={17} /> : <Store size={17} />}
              {item.label}
            </button>
          );
        })}
      </fieldset>
      <div className="landing-sides-explorer__stage" data-side={side}>
        <div className="landing-sides-explorer__copy">
          <span>{selected.label}</span>
          <h3>{selected.title}</h3>
          <ul>
            {selected.items.map((item) => (
              <li key={item}>
                <Check size={16} aria-hidden="true" /> {item}
              </li>
            ))}
          </ul>
        </div>
        {side === "customer" ? (
          <LoyaltyPass copy={copy.pass} filled={4} compact />
        ) : (
          <section className="landing-console" aria-label={copy.sides.merchant.label}>
            <div className="landing-console__header">
              <span className="landing-console__icon">
                <Store size={18} />
              </span>
              <p>
                <strong>{copy.sides.console.program}</strong>
                <small>{copy.sides.console.published}</small>
              </p>
            </div>
            <dl>
              <div>
                <dt>{copy.sides.console.progress}</dt>
                <dd>
                  <span style={{ width: "66%" }} />
                </dd>
              </div>
              <div>
                <dt>{copy.sides.console.locations}</dt>
                <dd>
                  <Store size={17} />
                </dd>
              </div>
              <div>
                <dt>{copy.sides.console.team}</dt>
                <dd>
                  <UsersRound size={17} />
                </dd>
              </div>
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}

export function BusinessExplorer({ copy }: { copy: MarketingCopy }) {
  const [selectedKey, setSelectedKey] = useState(copy.business.types[0]?.key ?? "cafe");
  const selected =
    copy.business.types.find((business) => business.key === selectedKey) ?? copy.business.types[0];
  if (!selected) return null;

  return (
    <div className="landing-business-explorer">
      <fieldset className="landing-business-explorer__options">
        <legend className="landing-control-label">{copy.business.previewLabel}</legend>
        {copy.business.types.map((business) => (
          <button
            type="button"
            key={business.key}
            aria-pressed={selected.key === business.key}
            onClick={() => setSelectedKey(business.key)}
          >
            {business.name}
          </button>
        ))}
      </fieldset>
      <div className="landing-business-explorer__preview" aria-live="polite">
        <span>
          <Store size={17} aria-hidden="true" /> {selected.name}
        </span>
        <LoyaltyPass
          copy={{ ...copy.pass, reward: selected.reward }}
          filled={4}
          goal={`${selected.goal} · ${selected.reward}`}
        />
      </div>
    </div>
  );
}
