import { AtlasEntryLayout } from "../../../components/atlas/AtlasEntryLayout";

type FpPageProps = {
  eyebrow?: string;
};

export function FpPage({ eyebrow = "Attributes" }: FpPageProps) {

  return (
    <AtlasEntryLayout eyebrow={eyebrow} title="FP">
      <div className="space-y-5 text-sm leading-relaxed text-white/70">
        <p>
          Focus Points are expended in performing any cognitively active tasks
          through the day, and are meant to roughly approximate energy levels.
        </p>

        <div>
          <h3 className="font-display text-base font-semibold text-white/85">
            Dopamine depletion results in unwillingness to take strenuous action
          </h3>
        </div>

        <p>
          One of the main ways of behavioural reinforcement is mediated by the
          brain&apos;s Nucleus Accumbens, via dopamine. In{" "}
          <a
            href="https://pubmed.ncbi.nlm.nih.gov/12649346/"
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
          >
            &quot;Nucleus accumbens dopamine and the regulation of effort in
            food-seeking behavior: implications for studies of natural
            motivation, psychiatry, and drug abuse&quot;
          </a>
          {" "}it is observed that dopamine depleted rats seldom engage in
          sustained effort to obtain tastier food, opting instead to be lazy
          and eat inferior chow.
        </p>

        <p>
          In my experience, I often end up in episodes of being unwilling to put in any work
          at all in life, entering a nihilistic trance, where all effort is deemed 
          futile, unrewarding and misguided. Although there are more complex reasons for this,
          constantly depleting myself of dopamine has a non-trivial contribution.
        </p>
        
        <p>
          This state must be avoided at all costs.
        </p>

        <div>
          <h3 className="font-display text-base font-semibold text-white/85">
            Emotional Regulation diminishes Self Control
          </h3>
        </div>

        <p>
          Self-control is an ability to monitor internal conflict, and as such,
          can be treated as an expendable resource (See{" "}
          <a
            href="https://assets.csom.umn.edu/assets/166733.pdf"
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
          >&quot;The Strength Model of Self-Control&quot;
          </a>{" "}
          and{" "}
          <a
            href="https://pubmed.ncbi.nlm.nih.gov/11483360/"
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
          >
            &quot;Conflict monitoring and cognitive control&quot;
          </a>
          ).Emotional Regulation is a suppression and monitoring of internal
          conflict, and severely drains self control. The depression status
          ailment is hands down the worst FP debuff possible: everything
          becomes impossible to do.
        </p>

        <p>
          This is doubly a problem, because the brain, when in a state of
          distress, will desperately try to get out of that state, and the
          release of dopamine is a fantastic way to do so. On one side, this
          means the mind craves highly dopaminergic activities more and on the
          other, self control is actively diminished by the regulation costs.
        </p>

        <p>
          I have got into rather problematic spirals with shame, because a loss
          of control due to constant shame, results in further failure and
          further shame.
        </p>

        <p>
          The best thing to allow natural processing of emotions is to not
          escape them with dopamine, and instead take the time to be bored and
          go over them. I thus think things like taking a walk should restore
          some FP. I also hold that FP scales with the Mind stat, which can be
          levelled up with meditation for instance, which is entirely about
          deliberate awareness.
        </p>

      </div>
    </AtlasEntryLayout>
  );
}
