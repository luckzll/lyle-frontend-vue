# Email-only login — design QA

Date: 2026-09-08. Selected target: Product Design option 1.

## Evidence

- Target: C:/Users/zhl20/.codex/generated_images/01a06a24-6132-78a0-800b-0fec2f0c97da/exec-adecba0f-6442-4759-8ad3-cd6eaa7686c0.png
- Desktop: docs/email-ui/login-desktop.png (1488 × 1058)
- Mobile: docs/email-ui/login-mobile.png (390 × 844)
- Settings: docs/email-ui/settings-desktop.png (synthetic preview user)
- Target and rendered desktop were emitted together for direct visual comparison twice; target and settings capture were compared together.

## Findings and resolutions

- First pass: login title and left brand sat too low. Corrected right top padding and left content offset; second capture matches target hierarchy.
- Preserved 42/58 split, lavender raster waves, indigo actions, rounded fields and Lucide icons. Generated wave detail and native Chinese font rasterization differ slightly from the concept.
- Intentional product adaptation: bound identity belongs in authenticated settings, not the public login screen. Settings retains its existing navigation and card system.
- Added provider-neutral email help per user request. This shifts the CAPTCHA and later controls slightly down relative to the mock.
- Mobile login hides decorative story, retains brand and stacks usable form. Invalid-address message wraps without overlapping controls at 390 px.
- Bound email masks by default; clicking “查看完整邮箱” reveals synthetic address and changes action to “隐藏”. Password UI is absent. Account/session cards remain.
- Mail icon, code icon and verification icon are library icons; wave background is raster, not CSS illustration. Explicit input labels, one-time-code autocomplete, visible focus styles and role=alert/status are present.

## Validation

- Frontend unit suite: 182 passing tests in 30 files.
- Backend targeted regression suite: 79 passing, zero failures/errors.
- Frontend production build passed before final tiny guard adjustment; final build checked separately.
- Browser checked malformed QQ suffix and missing CAPTCHA proof; no mail was sent. Mock API has no real credentials.
- E2E specs updated for email-only controls and provider SDK stubbing. Playwright CLI suite was not run this turn.

## Remaining gates

- Real CAPTCHA success/error/expiry and SMTP round-trip require selected provider credentials and an actual human challenge.
- Settings mobile full-page screenshot failed in browser capture; mobile settings visual acceptance remains pending.
- Formal automated accessibility scan and all-browser E2E remain pending.

Overall result at the original cloud-provider pass: blocked for complete release acceptance.

## Tianai implementation follow-up (2026-09-08)

This supersedes the external-provider configuration gate above. The user selected self-hosted Tianai, and requested removal of the email-provider helper line.

- No cloud CAPTCHA keys or external browser scripts are required now.
- Actual Tianai images were inspected in the in-app browser at 1488 × 1058 and 390 × 844; captures: docs/email-ui/tianai-desktop.png and tianai-mobile.png. Expanded puzzle scrolls vertically on small screens without horizontal overflow.
- Local preview uses the real Java image engine with an expiring TEST memory cache. It does not access production or send mail.
- Fixed keyboard interaction: starting the range control now reactively enables the confirmation button.
- Frontend: 183 unit tests, 6 Chromium E2E tests, and production build passed.
- Backend: 80 targeted tests passed; real image generation and answer matching are exercised with mocked Redis.
- E2E covers the CAPTCHA proof-to-email flow, invalid OTP, cooldown, redirect, failed challenge/retry, changing email, outage, keyboard use, mobile width and no serious/critical axe violations on login.
- Production Redis/SMTP round-trip and human completion on the deployed site remain release checks, not missing cloud credentials.

Result for the Tianai implementation: passed local checks; not deployed. Previous settings-mobile and all-browser review gaps are not claimed resolved.

## Reference slider refinement (2026-09-08)

- Visual source: user screenshot `C:/Temp/codex-clipboard-b32204a9-6ffd-426c-a8ce-e71f01ed3925.png`, specifically its red-box slider cards. Source and rendered desktop screenshot were viewed together for comparison of the component, not the unrelated GitHub page.
- Matched white compact card, bold instruction, 5:3 image, broad light-gray track, white arrow handle, and bottom refresh/close controls. Surrounding login design is unchanged.
- Intentional differences: Lucide arrow instead of the dotted upstream arrow; text attribution instead of recreating the logo; keyboard help and an explicit confirmation control retained for accessibility. Background artwork is independent of the screenshot.
- Browser checks: real Java preview changed cat → generated mountain lake → cat through the refresh control. No CAPTCHA was solved through browser automation and no mail was sent.
- Captures: `captcha-reference-desktop.png` (1488 × 1058), `captcha-reference-mobile.png` (390 × 1100). Mobile card and footer fit the available width; page scrolls vertically.
- Frontend production build passed. Backend's 65 targeted service/controller tests passed, including refresh background exclusion and real-engine matching of a refreshed challenge. Existing full E2E suite was not rerun in this refinement.
- Scoped visual result: passed, no blocking layout issues observed. This is a local preview, not a production deployment or SMTP acceptance.
