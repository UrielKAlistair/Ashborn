import { AtlasEntryLayout } from "../../../components/atlas/AtlasEntryLayout";

type ResolutePageProps = {
  eyebrow?: string;
};

export function ResolutePage({
  eyebrow = "Status Ailments",
}: ResolutePageProps) {
  return (
    <AtlasEntryLayout eyebrow={eyebrow} title="Resolute">
      <p className="text-sm tracking-[0.12em] text-white/55">
        <div>
          <h3 className="text-base font-semibold tracking-[0.18em] text-white/80">
            Resolve manifests as Discipline
          </h3>
        </div>
        
      </p>
    </AtlasEntryLayout>
  );
}
