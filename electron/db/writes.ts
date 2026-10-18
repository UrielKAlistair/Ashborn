import Database from "better-sqlite3";
import type { BoardWidget } from "../../src/shared/types.js";
import type { LedgerRow, TaskEffectRow, TaskInstanceRow } from "../dbTypes.js";
import { getTodayDate } from "./dates.js";

export function saveDashboardWidgetsInDb(db: Database.Database, widgets: BoardWidget[]) {
  const clearWidgets = db.prepare("DELETE FROM dashboard_widgets");
  const insertDashboardWidget = db.prepare(`
    INSERT INTO dashboard_widgets (board_id, x, y, w, h, position)
    VALUES (@board_id, @x, @y, @w, @h, @position)
  `);

  db.transaction(() => {
    clearWidgets.run();

    widgets.forEach((widget, position) => {
      insertDashboardWidget.run({
        board_id: widget.boardId,
        x: widget.x,
        y: widget.y,
        w: widget.w,
        h: widget.h,
        position,
      });
    });
  })();
}

export function toggleTaskInstanceInDb(db: Database.Database, instanceId: string) {
  const todayDate = getTodayDate();
  const readInstance = db.prepare(`
    SELECT id, task_id, date, status, completed_at
    FROM task_instances
    WHERE id = ?
  `);
  const readEffects = db.prepare(`
    SELECT kind, target, amount, position
    FROM task_effects
    WHERE task_id = ?
    ORDER BY position
  `);
  const readResource = db.prepare(`
    SELECT current, max
    FROM character_resources
    WHERE resource_key = ?
  `);
  const readLedger = db.prepare(`
    SELECT kind, target, amount
    FROM effect_ledger
    WHERE task_instance_id = ?
    ORDER BY id
  `);
  const updateInstance = db.prepare(`
    UPDATE task_instances
    SET status = @status, completed_at = @completed_at
    WHERE id = @id
  `);
  const updateAttribute = db.prepare(`
    UPDATE character_attributes
    SET xp = xp + @delta
    WHERE attribute_key = @attribute_key
  `);
  const updateResource = db.prepare(`
    UPDATE character_resources
    SET current = @current
    WHERE resource_key = @resource_key
  `);
  const insertLedger = db.prepare(`
    INSERT INTO effect_ledger (task_instance_id, kind, target, amount, applied_at)
    VALUES (@task_instance_id, @kind, @target, @amount, @applied_at)
  `);
  const deleteLedger = db.prepare("DELETE FROM effect_ledger WHERE task_instance_id = ?");

  db.transaction(() => {
    const instance = readInstance.get(instanceId) as TaskInstanceRow | undefined;

    if (!instance) {
      throw new Error(`Task instance not found: ${instanceId}`);
    }

    if (instance.status === "open") {
      const effects = readEffects.all(instance.task_id) as Array<TaskEffectRow & { position: number }>;

      effects.forEach((effect) => {
        if (effect.kind === "attribute_xp") {
          updateAttribute.run({
            delta: effect.amount,
            attribute_key: effect.target,
          });

          insertLedger.run({
            task_instance_id: instanceId,
            kind: effect.kind,
            target: effect.target,
            amount: effect.amount,
            applied_at: todayDate,
          });

          return;
        }

        const resource = readResource.get(effect.target) as
          | { current: number; max: number }
          | undefined;

        if (!resource) {
          return;
        }

        const nextCurrent = Math.max(0, Math.min(resource.max, resource.current + effect.amount));
        const actualDelta = nextCurrent - resource.current;

        updateResource.run({
          current: nextCurrent,
          resource_key: effect.target,
        });

        insertLedger.run({
          task_instance_id: instanceId,
          kind: effect.kind,
          target: effect.target,
          amount: actualDelta,
          applied_at: todayDate,
        });
      });

      updateInstance.run({
        id: instanceId,
        status: "done",
        completed_at: todayDate,
      });

      return;
    }

    const ledgerEntries = readLedger.all(instanceId) as LedgerRow[];

    ledgerEntries.forEach((entry) => {
      if (entry.kind === "attribute_xp") {
        updateAttribute.run({
          delta: -entry.amount,
          attribute_key: entry.target,
        });

        return;
      }

      const resource = readResource.get(entry.target) as
        | { current: number; max: number }
        | undefined;

      if (!resource) {
        return;
      }

      const nextCurrent = Math.max(0, Math.min(resource.max, resource.current - entry.amount));

      updateResource.run({
        current: nextCurrent,
        resource_key: entry.target,
      });
    });

    deleteLedger.run(instanceId);

    updateInstance.run({
      id: instanceId,
      status: "open",
      completed_at: null,
    });
  })();
}
