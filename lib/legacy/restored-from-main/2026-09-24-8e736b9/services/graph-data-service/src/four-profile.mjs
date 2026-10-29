import { mark } from "@red-cup-engineering/computer-data-engineering-services-section/signcell/utterance";
import {
  bottom,
  chargeValue,
  joinKnowledge,
  negate,
  valueOf,
  witnessedPotential,
} from "@lenticule-science/metrologic/articulation/predicating/positing/bilattice-charge";
import {
  linearFusionValue,
  linearResiduumValue,
  truthOrderResiduation,
} from "@lenticule-science/metrologic/articulation/predicating/positing/bilattice-linear-logic";

const freezeList = (values) => Object.freeze([...values]);
const evidenceValues = (marks) => freezeList(marks.map((witness) => witness.value));

/** The scalar twist-residuated family, kept distinct from cell moves and truth-Heyting fusion. */
export const fourScalarTwist = Object.freeze({
  fusion(left, right) {
    return linearFusionValue(chargeValue(left), chargeValue(right)).name;
  },
  residuum(left, right) {
    return linearResiduumValue(chargeValue(left), chargeValue(right)).name;
  },
  residuation(left, right, bound) {
    return truthOrderResiduation(chargeValue(left), chargeValue(right), chargeValue(bound));
  },
});

/**
 * The finite FOUR PAM profile. It tracks independent for/against evidence,
 * accumulates only by knowledge join, and names the four readings with the
 * live Obsmetrologia/articulating vocabulary.
 */
export function createFourProfile({ positiveDatums = ["for"], negativeDatums = ["against"] } = {}) {
  const positive = new Set(positiveDatums);
  const negative = new Set(negativeDatums);
  return Object.freeze({
    name: "pam-finite-four",
    scalarTwist: fourScalarTwist,
    bottom: () => bottom,
    contribute(observation, witness) {
      const polarity = observation.polarity ?? observation.datum ?? "for";
      const contribution = witnessedPotential(mark(witness));
      if (positive.has(polarity)) return contribution;
      if (negative.has(polarity)) return negate(contribution);
      throw new TypeError(`FOUR profile has no polarity mapping for ${JSON.stringify(polarity)}`);
    },
    join: joinKnowledge,
    reading: (carrier) => valueOf(carrier).name,
    witness(carrier) {
      return Object.freeze({
        profile: "pam-finite-four",
        value: carrier,
        reading: valueOf(carrier).name,
        evidence: Object.freeze({
          for: evidenceValues(carrier.evidence[0]),
          against: evidenceValues(carrier.evidence[1]),
        }),
      });
    },
  });
}

export const fourProfile = createFourProfile();
