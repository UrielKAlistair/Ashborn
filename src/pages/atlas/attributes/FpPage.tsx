import { useState } from "react";
import { AtlasEntryLayout } from "../AtlasEntryLayout";

type FpPageProps = {
  eyebrow?: string;
};

const privateGraphSrc = "/fp-quick-graph.png";

export function FpPage({ eyebrow = "Attributes" }: FpPageProps) {
  const [graphAvailable, setGraphAvailable] = useState(true);

  return (
    <AtlasEntryLayout eyebrow={eyebrow} title="FP">
      <div className="space-y-5 text-sm tracking-[0.12em] text-white/55">
        <p>
          Focus Points are expended in performing any cognitively active tasks
          through the day, and are meant to roughly approximate energy levels.
        </p>

        <div>
          <h3 className="text-base font-semibold tracking-[0.18em] text-white/80">
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
          and eat inferior chow. We end up being unwilling to put in the effort
          for the things good for us, very often from being depleted of
          dopamine by technology.
        </p>

        <p>
          The FP bar is a crude attempt at modelling this nature: each day
          offers a large amount of FP that can lend itself to sustained effort,
          but engaging in highly dopaminergic activities incurs a large
          percentage based FP cost that cripples our ability to do other
          things. Doing work first thing in the day is thus, actually, well
          motivated advice: it becomes progressively harder and provides less
          reinforcement with increasing dopamine depletion.
        </p>

        <p>
          I want to model the idea that I need to maintain myself such that I
          have healthy FP levels in order to be productive, and make that really
          apparent with this aspect. I&apos;m not making any hard FP
          constraints to tasks: I&apos;m only making FP heavily influence the
          EXP multiplier, which is a nice way I can materialize ideas to
          action.
        </p>

        <div>
          <h3 className="text-base font-semibold tracking-[0.18em] text-white/80">
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
          further shame. Because awareness itself is self-control, I took the
          time to sit and analyze my mind, and what my strongest triggers are.
          Quick graph here.
        </p>

        {graphAvailable ? (
          <img
            src={privateGraphSrc}
            alt="Quick graph"
            onError={() => setGraphAvailable(false)}
            className="w-full rounded-sm border border-white/12"
          />
        ) : (
          <div className="flex h-56 w-full items-center justify-center rounded-sm border border-white/12 bg-black/20 text-sm uppercase tracking-[0.24em] text-white/35">
            Redacted
          </div>
        )}

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
