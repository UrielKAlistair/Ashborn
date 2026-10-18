import { AtlasEntryLayout } from "../../../components/atlas/AtlasEntryLayout";

type CleanRoomPageProps = {
  eyebrow?: string;
};

export function CleanRoomPage({
  eyebrow = "Status Ailments",
}: CleanRoomPageProps) {
  return (
    <AtlasEntryLayout eyebrow={eyebrow} title="Clean room">
      <p className="text-sm tracking-[0.12em] text-white/55">
        The Clean Room status provides a 10% EXP buff.
        The Unclean Room status provides a 20% EXP debuff.
      </p>
    </AtlasEntryLayout>
  );
}
