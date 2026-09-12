"use client";

import Image from "next/image";

export function CustomerMerchantIdentity({
  name,
  logoDataUri,
  locale,
  showName = true,
  className = "",
}: {
  name: string;
  logoDataUri?: string | null | undefined;
  locale: "en" | "ar";
  showName?: boolean;
  className?: string;
}) {
  const initial = name.slice(0, 1).toLocaleUpperCase(locale);
  return (
    <span className={`customer-merchant-identity ${className}`.trim()}>
      {logoDataUri ? (
        <Image
          className="customer-merchant-identity__logo"
          src={logoDataUri}
          alt=""
          width={96}
          height={96}
          unoptimized
        />
      ) : (
        <i aria-hidden="true">{initial}</i>
      )}
      {showName ? <strong>{name}</strong> : null}
    </span>
  );
}
