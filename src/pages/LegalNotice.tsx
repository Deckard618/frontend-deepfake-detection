import { LegalPage } from "../components/LegalPage";

export default function LegalNotice() {
  return (
    <LegalPage title="Mentions légales" updated={<>Dernière mise à jour : 17 octobre 2026 · <a href="/legal-en">English version</a></>}>
      <section>
        <h2>Éditeur</h2>
        <p>
          Le site AI Detection &amp; Forensics Lab est édité à titre non professionnel par une personne physique.
          Conformément à la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique (LCEN), l'éditeur
          a choisi de ne pas rendre publiques ses coordonnées, qui ont été communiquées à l'hébergeur.
        </p>
      </section>

      <section>
        <h2>Hébergement</h2>
        <p>
          <strong>Cloudflare, Inc.</strong>, 101 Townsend St, San Francisco, CA 94107, États-Unis · +1 (650) 319-8930 · cloudflare.com
          <br />
          Les fichiers des modèles sont servis par Hugging Face (huggingface.co).
        </p>
      </section>

      <section>
        <h2>Un site de démonstration</h2>
        <p>
          Ce site est une démonstration expérimentale et éducative, fournie gratuitement et « en l'état ». Il peut être
          modifié, interrompu ou arrêté à tout moment, sans préavis.
        </p>
        <p>
          Les résultats sont des <strong>probabilités</strong> calculées par des modèles d'apprentissage automatique, pas des
          constats. Ils peuvent se tromper dans les deux sens (contenu authentique signalé comme généré, contenu généré non
          détecté), en particulier sur des images compressées, retouchées ou issues de générateurs récents. Un score n'est ni
          une preuve ni une certification, et ne doit pas fonder à lui seul une décision (juridique, disciplinaire,
          professionnelle, journalistique ou autre). Les vues forensiques sont des aides visuelles à interpréter avec prudence.
        </p>
      </section>

      <section>
        <h2>Responsabilité</h2>
        <p>
          Dans les limites permises par la loi, l'éditeur ne donne aucune garantie d'exactitude, de disponibilité ou
          d'adéquation à un usage particulier, et ne saurait être tenu responsable des conséquences de l'utilisation des
          résultats ni des interruptions du site. Vous êtes seul responsable des contenus que vous analysez et devez disposer
          des droits nécessaires.
        </p>
      </section>

      <section>
        <h2>Données personnelles et cookies</h2>
        <ul>
          <li>
            Les images, vidéos et textes que vous analysez sont traités uniquement dans votre navigateur. Ils ne sont ni
            envoyés à l'éditeur ou à un tiers, ni enregistrés.
          </li>
          <li>Pas de compte, pas de cookie, pas de mesure d'audience, pas de publicité. L'éditeur ne collecte aucune donnée personnelle.</li>
          <li>
            Votre navigateur garde en cache les modèles téléchargés pour ne pas les retélécharger. Ce stockage est strictement
            nécessaire au service ; vous pouvez le vider depuis l'onglet Detect ou les réglages du navigateur.
          </li>
          <li>
            Comme pour tout site, l'hébergeur et Hugging Face reçoivent les données techniques de connexion (adresse IP,
            navigateur) nécessaires pour vous transmettre les pages et les modèles, selon leurs propres politiques de confidentialité.
          </li>
        </ul>
        <p>Vous pouvez adresser une réclamation à la CNIL (cnil.fr).</p>
      </section>

      <section>
        <h2>Propriété intellectuelle</h2>
        <p>
          Les textes et l'interface du site appartiennent à l'éditeur. Les modèles PE-Core sont distribués sous licence
          Apache 2.0, celle de Perception Encoder (Meta) dont ils sont dérivés
          (<a href="/models/pe_tiny/LICENSE-pe_tiny.txt">texte de la licence</a>). Le modèle ResNet-50 6 canaux est
          distribué sous licence BSD 3-Clause, celle de l'implémentation de ResNet-50 de torchvision. Les modèles de
          détection de texte Ettin sont distribués sous licence MIT, celle des encodeurs Ettin (Johns Hopkins University)
          dont ils sont dérivés (<a href="/models/ettin-68m/LICENSE-ettin-68m.txt">texte de la licence</a>). Le site
          utilise aussi des logiciels libres, dont React, ONNX Runtime Web et OpenCV.js, chacun sous sa propre licence.
        </p>
      </section>

      <section>
        <h2>Droit applicable</h2>
        <p>Les présentes mentions sont régies par le droit français.</p>
      </section>
    </LegalPage>
  );
}
