# LEGAL.md — compliance risks before launch

An audit of Cat Frame against six common legal risks for small apps, plus two gaps found along the way. Written 2026-09-27. Not legal advice: have someone qualified review the age policy, terms and privacy policy before launch.

## Summary

| # | Risk | Status | Action |
|---|------|--------|--------|
| 1 | No age gate at signup (COPPA) | **Open** | Code change |
| 2 | Google Fonts loaded from Google's servers (GDPR) | Clear | None |
| 3 | Session replay recording input (CIPA) | Clear | Keep it that way |
| 4 | Marketing email without unsubscribe/address (CAN-SPAM) | Clear for now | Check before first email |
| 5 | Renewal terms not next to the subscribe button | **Partial** | Code change |
| 6 | No registered DMCA agent | **Open** | Registration + code change |
| 7 | Terms and privacy policy not linked | **Open** | Write docs + link |
| 8 | No way to report or block content | **Open** | Code change (App Store requirement) |

## 1. Age gate — open

**Risk.** COPPA penalties apply per child under 13 whose personal data is collected without verifiable parental consent. Cat Frame collects email, precise location and photos, and a cat-photo game is likely to appeal to children.

**Current state.** [SignInSignUpScreen.tsx](src/screens/auth/SignInSignUpScreen.tsx) asks only for email and password. Nothing asks for age.

**Fix.**
- Add a neutral age question to signup: ask for a birth year or date, don't use a yes/no "Are you 13+?" checkbox that pushes users toward the answer.
- Under 13: block signup, show a neutral message, and don't store what they entered. Remember the result on the device so the user can't just go back and change their answer.
- Store only the outcome (`age_verified_13_plus`) on the server, not the birth date.
- Check that the App Store and Play Store age ratings match (no "Made for Kids" category).

## 2. Google Fonts — clear

`@expo-google-fonts/*` ships the font files inside the app bundle and `useFonts` in [App.tsx](App.tsx) loads them locally. Nothing is requested from Google while the app runs.

**Watch for.** A web build or marketing site that uses a `fonts.googleapis.com` `<link>`. Self-host the fonts there too.

## 3. Session replay — clear

No Sentry, PostHog, LogRocket, Clarity or similar SDK is installed.

**Watch for.** If one is added later, leave replay off, or enable it only after consent with all text inputs masked.

## 4. Marketing email — clear for now

The app and server send no email; support is only a `mailto:` link.

**Before the first launch or newsletter email:**
- Send it through a service (Mailchimp, Resend, Loops, etc.) that adds a working unsubscribe link.
- Include a real postal address (a PO box or virtual mailbox is fine).
- Use an honest subject line and "From" name.
- Process unsubscribes within 10 business days.

## 5. Subscription renewal terms — partial

**Risk.** California's auto-renewal law, and Apple and Google's own rules, require the renewal terms to appear clearly and conspicuously right next to the purchase button. If they don't, renewals can be treated as unconditional gifts that have to be refunded.

**Current state.** The Pro section in [ShopScreen.tsx](src/screens/profile/ShopScreen.tsx) describes the features. The only renewal wording is the footnote at the bottom of the shop: "Pro renews until you cancel."

**Fix.** Directly beside or under the Pro purchase button, show:
- the price and billing period, e.g. "$X.XX / month", using the localized price from the store
- "Renews automatically until cancelled"
- how to cancel, e.g. "Cancel anytime in your App Store / Play Store subscription settings"
- links to the Terms and Privacy Policy
- the trial length and the price after the trial, if a free trial is ever offered

## 6. DMCA agent — open

**Risk.** Without a registered agent, the platform loses DMCA safe harbor for photos users upload, and statutory damages can reach $150K per work.

**Fix (outside the code).**
1. Register a designated agent in the U.S. Copyright Office's DMCA Designated Agent Directory ($6, renew every 3 years).
2. Put the same agent contact details in the Terms of Service.
3. Adopt a repeat-infringer policy (terminate accounts with repeated valid notices) and state it in the Terms.

**Fix (in the code).**
- Add a copyright contact row in [SettingsScreen.tsx](src/screens/profile/SettingsScreen.tsx) (e.g. `copyright@catframe.app`).
- Add a way to take a photo down quickly on the server once a notice arrives.

## 7. Terms and privacy policy — open

**Current state.** [SignInSignUpScreen.tsx:182](src/screens/auth/SignInSignUpScreen.tsx#L182) says "By continuing you agree to our terms and privacy policy", but neither is linked and neither exists yet.

**Fix.**
- Write both. The privacy policy must cover location, photos, account deletion and any third parties (Supabase, the stores).
- Host them at stable URLs and link them from signup, Settings and the Pro purchase area.
- Add the privacy policy URL to the App Store and Play Store listings (required).

## 8. Report and block — open

**Risk.** Apple guideline 1.2 requires apps with user-generated content to let users report objectionable content, block abusive users, and act on reports quickly. Reviewers reject apps that lack this.

**Current state.** [ViralFeedScreen.tsx](src/screens/home/ViralFeedScreen.tsx) and [PhotoDetailScreen.tsx](src/screens/album/PhotoDetailScreen.tsx) have no report or block action.

**Fix.**
- Add "Report photo" (reason: inappropriate, copyright, spam, other) and "Block user" to the photo menu.
- Add a server route that stores reports, and hide a reported photo for the reporter straight away.
- Filter blocked users out of the feed server-side.
- Commit to reviewing reports within 24 hours and say so in the Terms.

## Launch checklist

- [ ] Age gate at signup (1)
- [ ] Renewal terms beside the Pro button (5)
- [ ] DMCA agent registered with the Copyright Office (6)
- [ ] Copyright contact in Settings and in the Terms (6)
- [ ] Terms of Service and Privacy Policy written, hosted and linked (7)
- [ ] Report photo and block user (8)
- [ ] Store listings: age rating and privacy policy URL (1, 7)
- [ ] Before any marketing email: unsubscribe link and postal address (4)
