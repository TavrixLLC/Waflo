# Multi-program locale preservation

The Customer Web merchant root resolves the locale once and includes it as `lang` on
every Program chooser link. English remains `lang=en`; Arabic remains `lang=ar` and the
selected join page remains RTL.

Single-program canonical redirects, header/logo navigation, and the language switcher
also preserve the resolved locale. The optional `tenant` query value is carried only
when the direct request host is `localhost`, `127.0.0.1`, or `lvh.me`. Production
hosts ignore that query override and use the host-derived merchant context.

Playwright covers:

- multi-program English chooser to English/LTR join;
- multi-program Arabic chooser to Arabic/RTL join;
- Arabic header/logo navigation retaining locale and local tenant;
- single-program canonical redirect with locale;
- merchant-host routing without a tenant query override;
- no redirect loop.

Visible proof is in `screenshots/03-program-chooser.png`,
`screenshots/03b-program-chooser-arabic.png`, and
`screenshots/05-arabic-rtl-join-page.png`.

