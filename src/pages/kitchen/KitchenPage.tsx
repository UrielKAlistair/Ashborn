import type { Snapshot } from "../../shared/types";
import type { Act } from "../home/HomePage";
import { CookbookPage } from "./CookbookPage";
import { MealPlan } from "./MealPlan";
import { StockPanel } from "./StockPanel";

export type KitchenScreen = "plan" | "stocks" | "recipes";

type KitchenPageProps = {
  snapshot: Snapshot;
  act: Act;
  phone: boolean;
  screen: KitchenScreen;
  recipeId: string | null;
  onNavigate: (path: string) => void;
};

// The Kitchen section. Desktop: the meal plan beside the stock bars on one page, and the
// cookbook on another. Phone: meal plan, stocks and recipes, one screen each.
export function KitchenPage({ snapshot, act, phone, screen, recipeId, onNavigate }: KitchenPageProps) {
  const { kitchen } = snapshot;
  const openRecipe = (id: string | null) => onNavigate(id ? `/kitchen/recipes/${id}` : "/kitchen/recipes");

  if (screen === "recipes") return <CookbookPage kitchen={kitchen} act={act} phone={phone} recipeId={recipeId} onOpenRecipe={openRecipe} />;

  if (phone) {
    return screen === "stocks" ? (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <StockPanel kitchen={kitchen} act={act} />
      </div>
    ) : (
      <MealPlan kitchen={kitchen} act={act} phone onOpenRecipe={openRecipe} />
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 gap-5">
      <div className="flex min-h-0 min-w-0 flex-[2] flex-col">
        <MealPlan kitchen={kitchen} act={act} phone={false} onOpenRecipe={openRecipe} />
      </div>
      <div className="flex min-h-0 w-[30%] min-w-[16rem] max-w-[24rem] flex-col">
        <StockPanel kitchen={kitchen} act={act} />
      </div>
    </div>
  );
}
