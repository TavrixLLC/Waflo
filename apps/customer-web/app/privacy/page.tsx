import { Card } from "@waflo/ui";
import { CustomerHeader } from "../page";

export const dynamic = "force-dynamic";

export default function CustomerPrivacyPage() {
  return (
    <main className="customer-page legal-page">
      <CustomerHeader locale="en" />
      <Card>
        <span className="customer-kicker">CUSTOMER PRIVACY · LEGAL REVIEW PENDING</span>
        <h1>How Waflo handles loyalty-card data</h1>
        <p>
          Tavrix LLC owns and operates the Waflo platform. The merchant shown on your enrollment
          page operates its loyalty program where legally appropriate. This notice is a product
          implementation draft and remains subject to counsel review.
        </p>
        <h2>Data and purpose</h2>
        <p>
          Waflo stores the name displayed on your card, your language, enrollment consent, card
          progress, and—only when the program requests it—an email address. Email is encrypted and
          used for secure card transfer and separately consented communications. QR codes contain
          opaque, revocable credentials rather than your name, email, or progress.
        </p>
        <h2>Wallet providers and transfer</h2>
        <p>
          If you choose Apple Wallet or Google Wallet, the provider receives the card fields needed
          to display and update the pass. Moving a card rotates its QR credential and invalidates
          old provider objects. Transfer without email is less secure because possession of a QR
          screenshot may be enough to prove control.
        </p>
        <h2>Your choices and rights</h2>
        <p>
          Marketing consent is separate and optional. Customer data export and deletion workflows,
          rights-request contacts, retention periods, and jurisdiction-specific language will be
          finalized in W4 and through legal review. No Tavrix LLC postal address is asserted here.
        </p>
      </Card>
    </main>
  );
}
