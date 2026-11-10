import { AtlasEntryLayout } from "../../../components/atlas/AtlasEntryLayout";

type CognitiveOffloadingPageProps = {
  eyebrow?: string;
};

export function CognitiveOffloadingPage({
  eyebrow = "Attributes",
}: CognitiveOffloadingPageProps) {
  return (
    <AtlasEntryLayout eyebrow={eyebrow} title="Cognitive Offloading"> 
        <div className="space-y-5 text-sm leading-relaxed text-ink/70">  

        <div>
          <h3 className="font-display text-base font-semibold text-ink/85">
            Getting things done
          </h3>
        </div>
   
             
        <p>
            I stuggle a lot with keeping track of everything I need to do. When I'm
            confronted with a large number of indepedent, (or worse, non-trivial) tasks, 
            I am predisposed to subconsciously lose hope about being on top of everything.   
        </p>

        <p>
            I have an expectation of myself that I will give my best towards solving the 
            problems that matter to me. I deem these quests worthy of pursuit, failing them,
            therefore, by my own measure, is a damaging defeat. When all that I wish to do,
            or ought to do, exceeds my working memory, the logical conclusion my brain draws
            is that the probability of failure has increased substantially. It spends a lot 
            of time figuring out what order to do things, and storing these plans in RAM. 
            There is no force of reassurance that all that must be done, will be done.
        </p>

        <p>
            I believe this predicament to be a function of my neuroticism and perfectionism,
            but it is a common enough predicament that the widely popular book "Getting Things Done"
            revolves around systems that can essentially give you some soothing assurance that There
            exists some external system trusting which, will allow you to stop worrying about being
            on top of all your tasks: you can trust this system, that there will exist a plan, that 
            you made, and all the open threads will be taken care of.
        </p>

        <p>
            I've tried a few GTD frameworks: not fun to maintain. Not motivating enough to keep them up.
            I notice that whenver I make a todo list, it's often a graph, not a list. 
            I wanted a DAG planner, and this is what Ashborn is. I want to move aside quests spatially, 
            hide them, grey them out, and have a visual representation of my next sequence of tasks I can 
            keep referring back to. For tasks that are not really "quests", a todo representation is also presented.
        </p>
        

        </div>
    </AtlasEntryLayout>
  );
}
