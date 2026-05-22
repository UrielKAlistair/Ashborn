import { AtlasEntryLayout } from "./AtlasEntryLayout";

type PurposePageProps = {
  eyebrow?: string;
};

export function PurposePage({
  eyebrow = "Philosophy",
}: PurposePageProps) {
  return (
    <AtlasEntryLayout eyebrow={eyebrow} title="Purpose">
      <div className="space-y-5 text-sm tracking-[0.12em] text-white/55">
        <div>
          <h3 className="text-base font-semibold tracking-[0.18em] text-white/80">
            Self Determination Theory of Purpose
          </h3>
        </div>

        <p>
          I first encountered this idea in Cal Newport&apos;s &quot;So Good They
          Can&apos;t Ignore You&quot;, where he builds why career satisfaction can
          be broken down into the pillars of SDT, and I later discovered this
          theory on its own accord, where it was often linked to happiness,
          motivation and purpose.
        </p>

        <div className="space-y-4">
          <div>
            <p className="font-medium text-white/72">1. Competence</p>
            <p>
              You can&apos;t get stronger lifting next to nothing, you must push
              your capabilities. You may win or lose, but the fact that you
              tried gives you a sense of control over your life.
            </p>
          </div>

          <div>
            <p className="font-medium text-white/72">2. Autonomy/Control</p>
            <p>
              People who have purpose tend to make choices in their life,
              rather than having choices made for them. A lack of agency is a
              truly depressing thing. This is where you have active and passive
              challenges. The brain will feel overwhelmed or anxious if there
              are too many passive challenges relative to the number of active
              challenges.
            </p>
          </div>

          <p>
            That is, taking on more active challenges of your own volition
            positively affects your sense of purpose. This also tunes into a
            third concept of knowing what YOU truly want in life, rather than
            what the world expects of you, which if you find will act as a
            wellspring of power to achieve nearly anything.
          </p>

          <div>
            <p className="font-medium text-white/72">3. Relatedness</p>
            <p>
              Being connected to people etc. This is not easy to tackle head
              on, but I think I can stumble my way through this.
            </p>
          </div>
        </div>

        <p>
          In my life, I often find that I am directionless and devoid of
          purpose, despite the fact I have discovered what I truly want, and
          addressed the root of my emotional chaos, with prolonged
          introspection. I find that I am easily distractible, and cannot wrest
          control and steer my life in the direction I want. I already desire
          to push my boundaries, but the primary challenge to pursuing that with
          autonomy is how I conceive of my goals in my mind.
        </p>

        <p>
          For some reason the idea of setting tasks as quest objectives really
          appeals to me, because the way you finish a quest is by doing the
          objectives and walking to the map marker over and over again. Good
          goals are specific, measurable, attainable, relevant and time
          constrained, and major life quests are none of those things.
        </p>

        <p>
          A second serious problem is emotional friction: I want to be my best
          self but I run head first into a lot of internal resistance when I
          try. I am trying to untangle that mess and checkmate avoidant coping
          by setting up these really conscious systems, which make it clear what
          the actual costs and benefits are for each action I take on a
          day-to-day basis.
          I am basically trying to externalise and make "Playing the tape to the end" natural and easy.
        </p>
      </div>
    </AtlasEntryLayout>
  );
}
