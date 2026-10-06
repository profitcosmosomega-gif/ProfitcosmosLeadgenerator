/**
 * Consent wording shown on lead-capture forms.
 *
 * PLACEHOLDER — NOT LEGALLY APPROVED. This text must be replaced with wording reviewed by
 * qualified counsel for every jurisdiction ProfitCosmos Omega markets in. The version id is stored
 * with every consent record so it is always known which wording a prospect agreed to.
 */
export interface ConsentWording {
  version: string;
  approved: boolean;
  marketingEmail: string;
  marketingSms: string;
  marketingWhatsapp: string;
}

export const CURRENT_CONSENT_WORDING: ConsentWording = {
  version: 'placeholder-v0',
  approved: false,
  marketingEmail:
    '[PLACEHOLDER – pending legal review] I agree to receive emails from ProfitCosmos Omega Academy about its trading education programs. I can unsubscribe at any time.',
  marketingSms:
    '[PLACEHOLDER – pending legal review] I agree to receive text messages from ProfitCosmos Omega Academy. Reply STOP to opt out.',
  marketingWhatsapp:
    '[PLACEHOLDER – pending legal review] I agree to receive WhatsApp messages from ProfitCosmos Omega Academy. I can opt out at any time.',
};
