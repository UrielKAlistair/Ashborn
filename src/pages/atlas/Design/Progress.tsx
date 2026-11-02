import { AtlasEntryLayout } from "../../../components/atlas/AtlasEntryLayout";

type ProgressPageProps = {
  eyebrow?: string;
};

export function ProgressPage({
  eyebrow = "Attributes",
}: ProgressPageProps) {
  return (
    <AtlasEntryLayout eyebrow={eyebrow} title="Progress">
        <div className="space-y-5 text-sm leading-relaxed text-ink/70">  

        <div>
          <h3 className="font-display text-base font-semibold text-ink/85">
            Progress over points
          </h3> 
        </div>
   
             
        <p>
            A lot of habit tracker apps I've used reward the user with made up points, which you
            just stop caring about at some point. If I am in a position in my life where it is 
            tiring to do normal tasks, these things cannot motivate me. Rather, it is a sense of 
            progress that can lift my spirits. 
        </p>

        <p>
            Because of this, I opted to visually track two things, a level tracker within each quest,
            which is basically a progress bar that pushes you to acting on the quest, and a high level
            RPG level system. The RPG system is not as much a "made-up" point system as other trackers,
            as I am genuinely trying to level my core stats. Meditation levels MND and WIS slowly, Gymming 
            and other exercise scale STR and DEX variably. This incentivices keeping a balance of 
            activities in life, taking care of personal growth, physical and mental health.  
        </p>

        <p>
            Although I basically designed this by gamer instinct, it does look like there is some scientific 
            evidence in favour of my reasoning; This is more of a reassurance: Ashborn is primarily a 
            personally finetuned endeavour.
        </p>

        
        <ul className="list-disc space-y-3 pl-5">
        <li>
          Progress marks good days. In{" "}
          <a
            href="https://www.library.hbs.edu/working-knowledge/how-small-wins-unleash-creativity"
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
          >
            &quot;The Progress Principle&quot;
          </a>
          , 238 workers kept close to 12,000 daily diary entries, and making
          progress in meaningful work was the most prominent event on their
          best days. Across 108 samples,{" "}
          <a
            href="https://pub.uni-bielefeld.de/record/2643602"
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
          >
            &quot;Linking goal progress and subjective well-being: a
            meta-analysis&quot;
          </a>{" "}
          finds a correlation of 0.43 between goal progress and well-being,
          larger for progress than for reaching the goal. Both are
          correlations, not experiments.
        </li>

        <li>
          Recording progress on a goal helps reach it. In{" "}
          <a
            href="https://eprints.whiterose.ac.uk/91437/"
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
          >
            &quot;Does monitoring goal progress promote goal attainment? A
            meta-analysis of the experimental evidence&quot;
          </a>
          , 138 randomised trials give an effect of d = 0.40 on goal
          attainment, larger when progress is physically recorded. Most of
          these trials were health goals.
        </li>

        <li>
          Seeing a goal already underway speeds up the effort to finish it. In{" "}
          <a
            href="https://home.uchicago.edu/ourminsky/Goal-Gradient_Illusionary_Goal_Progress.pdf"
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
          >
            &quot;The goal-gradient hypothesis resurrected&quot;
          </a>
          , café customers given a 12-stamp coffee card with 2 bonus stamps
          finished the 10 required purchases in 12.7 days on average, against
          15.6 days for an empty 10-stamp card. In{" "}
          <a
            href="https://www.researchgate.net/publication/23547282_The_Endowed_Progress_Effect_How_Artificial_Advancement_Increases_Effort"
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
          >
            &quot;The endowed progress effect&quot;
          </a>
          , 34% of car-wash customers with a 10-stamp card carrying 2 stamps
          earned their free wash, against 19% with an empty 8-stamp card.
        </li>
        </ul>
        

        </div>
    </AtlasEntryLayout>
  );
}
