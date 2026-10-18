import { AtlasEntryLayout } from "../../../components/atlas/AtlasEntryLayout";

type HpPageProps = {
  eyebrow?: string;
};

export function HpPage({ eyebrow = "Attributes" }: HpPageProps) {
  return (
    <AtlasEntryLayout eyebrow={eyebrow} title="HP">
      <div className="space-y-5 text-sm tracking-[0.12em] text-white/55">
        <p>
          HP is the most abused stat in my life, because once I started living
          independently, performing even the most basic upkeep became
          non-essential. It seemed as if it was illogical to put effort into
          actions that didn&apos;t directly progress the main questline.
        </p>

        <p>
          With enough pushing of the limits, I&apos;ve come to realise that
          unsurprisingly, you don&apos;t operate well on low HP, unlike in
          games, where you deal the same damage no matter what HP you&apos;re
          at. I think that it&apos;s obvious that I need to take care of
          myself and abusing my HP bar intrinsically makes me feel worse. On the other
          hand, having a healthy sleep schedule, eating 3 meals, and doing a
          bit of exercise makes a huge difference in the overall headspace.
        </p>

      </div>
    </AtlasEntryLayout>
  );
}
