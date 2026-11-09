import { ObjectId } from "mongodb";
import type { Assignment } from "./db.js";
import { collections } from "./db.js";

export type AssignResult =
  | { kind: "assigned"; assignment: Assignment }
  | { kind: "judge-busy" } // the judge already holds a QUEUED assignment
  | { kind: "none-available" }; // no project is eligible for this judge right now

/**
 * TODO: implement. See the README for the rules.
 *
 * `judgeId` is already validated to exist by the route. Use `collections()` from ./db.js.
 * Add any helpers you need.
 */
export async function assignNext(judgeId: string): Promise<AssignResult> {
  const { projects, assignments } = collections();
  if (await assignments.findOne({ judgeId, status: "QUEUED" })) {
    return { kind: "judge-busy" };
  }

  const allProjects = await projects.find().toArray();
  const judgeAssignments = await assignments.find({ judgeId }).toArray();
  const assignedToJudge = new Set(judgeAssignments.map((a) => a.projectId));

  const queuedAssignments = await assignments.find({ status: "QUEUED" }).toArray();
  const currentlyQueued = new Set(queuedAssignments.map((a) => a.projectId));

  const available = allProjects.filter(
    (p) => !assignedToJudge.has(p._id) && !currentlyQueued.has(p._id)
  );
  if (available.length === 0) {
    return { kind: "none-available" };
  }
  const completedCounts = new Map<string, number>(available.map((p) => [p._id, 0]));
  const completedRows = await assignments
    .aggregate<{ _id: string; count: number }>([
      { $match: { status: "COMPLETED" } },
      { $group: { _id: "$projectId", count: { $sum: 1 } } },
    ])
    .toArray();
  for (const row of completedRows) {
    if (completedCounts.has(row._id)) {
      completedCounts.set(row._id, row.count);
    }
  }

  const minCompleted = Math.min(...available.map((p) => completedCounts.get(p._id)!));
  const candidates = available.filter((p) => completedCounts.get(p._id) === minCompleted);
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  const _id = new ObjectId();
  const createdAt = new Date();
  await assignments.insertOne({
    _id,
    judgeId,
    projectId: chosen._id,
    status: "QUEUED",
    createdAt,
  });

  return {
    kind: "assigned",
    assignment: { _id, judgeId, projectId: chosen._id, status: "QUEUED", createdAt },
  };
}
