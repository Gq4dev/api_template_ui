// The images the platform's own email templates already reference.
//
// Extracted from the vendored render core — every `{{ resources_base_url }}/…`
// path used across public/py/render_core/templates. Refresh with:
//
//   grep -rhoE "resources_base_url \}\}[^'\"]*" public/py/render_core/templates/ \
//     | sed 's|resources_base_url }}/||' | sort -u
//
// Why a list at all: these live on the legacy asset host
// (RESOURCES_BASE_URL, https://api.paypertic.com/notificaciones by default),
// which offers no listing endpoint. Nothing can enumerate them at runtime, and
// an author cannot guess "elements-img/ico-title/ico-success.png" — so a typo'd
// src renders as a broken image in a customer's inbox with no warning anywhere.
//
// This is a catalogue of what EXISTS, not an uploader. Adding a new image is a
// separate problem: the host is not managed by this service, and the API's
// presigned upload allocates a TEMPLATE VERSION, so pointing it at a PNG would
// store the image as a template. See the note in ImagePicker.

export interface AssetGroup {
  label: string;
  /** Paths relative to resources_base_url. */
  paths: string[];
}

export const EMAIL_ASSETS: AssetGroup[] = [
  {
    label: "Íconos de título",
    paths: [
      "elements-img/ico-title/ico-success.png",
      "elements-img/ico-title/ico-pending.png",
      "elements-img/ico-title/ico-rejected.png",
      "elements-img/ico-title/ico-cancel.png",
      "elements-img/ico-title/ico-refunded.png",
      "elements-img/ico-title/ico-objected.png",
      "elements-img/ico-title/ico-deferred.png",
      "elements-img/ico-title/ico-card.png",
      "elements-img/ico-title/ico-edit.png",
      "elements-img/ico-title/ico-envelope.png",
      "elements-img/ico-title/ico-share.png",
    ],
  },
  {
    label: "Elementos",
    paths: [
      "elements-img/ico-elements/ico-money.png",
      "elements-img/ico-elements/ico-wallet.png",
      "elements-img/ico-elements/ico-clock.png",
      "elements-img/ico-elements/ico-info.png",
      "elements-img/ico-elements/ico-contact.png",
      "elements-img/ico-elements/ico-editar.png",
      "elements-img/ico-elements/ico-web.png",
    ],
  },
  {
    label: "Medios de pago",
    paths: [
      "elements-img/ico-payment-options/ico-visa-credit.png",
      "elements-img/ico-payment-options/ico-mastercard.png",
      "elements-img/ico-payment-options/ico-amex.png",
      "elements-img/ico-payment-options/ico-cabal.png",
      "elements-img/ico-payment-options/ico-naranja.png",
      "elements-img/ico-payment-options/ico-maestro.png",
      "elements-img/ico-payment-options/ico-diners.png",
      "elements-img/ico-payment-options/ico-argencard.png",
      "elements-img/ico-payment-options/ico-cordobesa.png",
      "elements-img/ico-payment-options/ico-italcred.png",
      "elements-img/ico-payment-options/ico-nativa.png",
      "elements-img/ico-payment-options/ico-cbu.png",
      "elements-img/ico-payment-options/ico-pagofacil.png",
      "elements-img/ico-payment-options/ico-rapipago.png",
    ],
  },
  {
    label: "Logos y fondos",
    paths: [
      "img/logo-pagotic.svg",
      "img/logo-positivo-161x50.png",
      "elements-img/logos/collector-logo-ppt.png",
      "elements-img/logos/logo-pci.png",
      "elements-img/img/bg-collector-header.png",
      "elements-img/img/bg-collector-footer.png",
      "elements-img/img/bg-wallet.png",
      "elements-img/img/bg-pending.png",
    ],
  },
];

/** Flat list, for tests and for a quick "does this path exist" check. */
export const ALL_ASSET_PATHS: string[] = EMAIL_ASSETS.flatMap((g) => g.paths);
