import { LegalPage } from "../components/LegalPage";

export default function LegalNoticeEN() {
  return (
    <LegalPage title="Legal notice" updated={<>Last updated: October 21, 2026 · <a href="/legal">Version française</a></>}>
      <section>
        <h2>Publisher</h2>
        <p>
          AI Detection &amp; Forensics Lab is published on a non-professional basis by a private individual.
        </p>
      </section>

      <section>
        <h2>Hosting</h2>
        <p>
          <strong>Cloudflare, Inc.</strong>, 101 Townsend St, San Francisco, CA 94107, USA · +1 (650) 319-8930 · cloudflare.com
          <br />
          Model files are served by Hugging Face (huggingface.co).
        </p>
      </section>

      <section>
        <h2>A demo site</h2>
        <p>
          This site is an experimental, educational demo, provided free of charge and "as is". It may be changed,
          interrupted or shut down at any time without notice.
        </p>
        <p>
          Results are <strong>probabilities</strong> computed by machine-learning models, not findings. They can be wrong
          both ways (authentic content flagged as generated, generated content missed), especially on compressed or edited
          images or on images from recent generators. A score is neither proof nor a certification, and must not be the sole
          basis for any decision (legal, disciplinary, professional, journalistic or other). Forensic views are visual aids
          to be interpreted with care.
        </p>
      </section>

      <section>
        <h2>Liability</h2>
        <p>
          To the extent permitted by law, the publisher gives no warranty of accuracy, availability or fitness for a
          particular purpose, and is not liable for the consequences of using the results or for interruptions of the site.
          You are solely responsible for the content you analyze and must hold the necessary rights to it.
        </p>
      </section>

      <section>
        <h2>Personal data and cookies</h2>
        <ul>
          <li>
            The images, videos and texts you analyze are processed only in your browser. They are never sent to the
            publisher or to anyone else, and never stored.
          </li>
          <li>No account, no cookies, no analytics, no advertising. The publisher collects no personal data.</li>
          <li>
            Your browser keeps downloaded models in its cache so it does not download them again. This storage is strictly
            necessary for the service; you can clear it from the Detect tab or your browser settings.
          </li>
          <li>
            As with any website, the host and Hugging Face receive the technical connection data (IP address, browser)
            needed to deliver the pages and models to you, under their own privacy policies.
          </li>
        </ul>
        <p>You can lodge a complaint with the French data protection authority, the CNIL (cnil.fr).</p>
      </section>

      <section>
        <h2>Intellectual property</h2>
        <p>
          The site's texts and interface belong to the publisher. The PE-Core models are distributed under the Apache 2.0
          license of Meta's Perception Encoder, from which they derive
          (<a href="/models/pe_tiny/LICENSE-pe_tiny.txt">license text</a>). The ResNet-50 6-channel model is distributed
          under the BSD 3-Clause license of torchvision's ResNet-50 implementation. The Ettin text-detection models are
          distributed under the MIT license of the Ettin encoders (Johns Hopkins University), from which they derive
          (<a href="/models/ettin-68m/LICENSE-ettin-68m.txt">license text</a>). The site also uses open-source software,
          including React, ONNX Runtime Web and OpenCV.js, each under its own license.
        </p>
      </section>

      <section>
        <h2>Governing law</h2>
        <p>This notice is governed by French law.</p>
      </section>
    </LegalPage>
  );
}
