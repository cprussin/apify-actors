/**
 * Containers of common cookie-consent banners (CMPs). Hidden with CSS, which
 * is best-effort: unknown banners stay visible, and nothing is clicked, so no
 * consent is given on the user's behalf.
 */
export const COOKIE_BANNER_SELECTORS = [
  // OneTrust
  "#onetrust-consent-sdk",
  "#onetrust-banner-sdk",
  // Cookiebot
  "#CybotCookiebotDialog",
  "#CybotCookiebotDialogBodyUnderlay",
  // Usercentrics
  "#usercentrics-root",
  "#usercentrics-cmp-ui",
  // Didomi
  "#didomi-host",
  // Quantcast
  ".qc-cmp2-container",
  "#qc-cmp2-container",
  // Sourcepoint
  "[id^='sp_message_container']",
  // Google Funding Choices
  ".fc-consent-root",
  // TrustArc
  "#truste-consent-track",
  ".truste_box_overlay",
  ".truste_overlay",
  "#consent_blackbar",
  // consentmanager.net
  "#cmpbox",
  "#cmpbox2",
  "#cmpwrapper",
  // CookieYes
  ".cky-consent-container",
  ".cky-overlay",
  // Cookie Script
  "#cookiescript_injected",
  "#cookiescript_injected_wrapper",
  // Osano
  ".osano-cm-window",
  ".osano-cm-dialog",
  // HubSpot
  "#hs-eu-cookie-confirmation",
  // iubenda
  "#iubenda-cs-banner",
  ".iubenda-cs-container",
  // Termly
  "#termly-code-snippet-support",
  // Evidon / Crownpeak
  "#_evidon_banner",
  ".evidon-banner",
  // Axeptio
  "#axeptio_overlay",
  // tarteaucitron
  "#tarteaucitronRoot",
  // Klaro
  "#klaro",
  ".klaro",
  // Borlabs / Complianz / GDPR Cookie Compliance (WordPress)
  "#BorlabsCookieBox",
  ".cmplz-cookiebanner",
  "#cmplz-cookiebanner-container",
  "#moove_gdpr_cookie_info_bar",
  "#cookie-law-info-bar",
  ".cli-modal-backdrop",
  // Cookie Consent (Osano open source) / Ketch / Transcend / Fides
  ".cc-window",
  ".cc-banner",
  "#cc-main",
  "#ketch-consent-banner",
  "#lanyard_root",
  "#transcend-consent-manager",
  "#fides-overlay",
  // Amazon / generic ids and classes
  "#sp-cc",
  "#cookie-banner",
  ".cookie-banner",
  "#cookieBanner",
  "#cookie-consent",
  ".cookie-consent",
  "#cookieConsent",
  "#CookieConsent",
  ".cookie-consent-banner",
  "#cookie-notice",
  ".cookie-notice",
  "#gdpr-cookie-message",
  "#gdpr-banner",
  ".gdpr-banner",
  "#consent-banner",
  ".consent-banner",
  "[aria-label='cookieconsent']",
] as const;

/** Classes CMPs put on <html>/<body> to block scrolling while open. */
const SCROLL_LOCKS = [
  "sp-message-open",
  "ot-overflow-hidden",
  "didomi-popup-open",
  "qc-cmp2-ui-open",
  "cky-modal-open",
  "cmpbox-open",
];

/** CSS that hides known cookie banners and their scroll locks. */
export function cookieBannerCss(): string {
  const locks = SCROLL_LOCKS.flatMap((c) => [`html.${c}`, `body.${c}`]);
  return (
    `${COOKIE_BANNER_SELECTORS.join(",\n")} { display: none !important; visibility: hidden !important; }\n` +
    `${locks.join(", ")} { overflow: auto !important; position: static !important; }`
  );
}
