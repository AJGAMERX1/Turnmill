import { useState } from "react";
import {
  bodyIds,
  assemblyCamReadings,
  buildPoses,
  type CamLink,
  type JointConfig,
} from "./kinematics";
import type { WorkspaceProps } from "./secondaryVector";
import type { CamExpressions } from "./camLaw";
import { resolveThreadMates, type ThreadFrame } from "./threadMates";

type Props = WorkspaceProps & {
  law: CamExpressions;
  threadFrames?: ThreadFrame[];
  onOpenAssembly?: () => void;
};
export default function CamCoupling(props: Props) {
  const { project, features, onOpenAssembly } = props;
  const config: JointConfig = project.workspaces?.joints || {};
  const bodies = features.filter((f) => f.operation === "new");
  const sliders = bodies.filter(
    (b) => config[b.id]?.kind === "slider" || config[b.id]?.cam,
  );
  const [choice, setChoice] = useState("");
  const follower =
    sliders.find((b) => b.id === choice) ??
    sliders.find((b) => config[b.id]?.cam) ??
    sliders[0];
  const cams = bodies.filter((b) =>
    ["revolute", "screw", "cylindrical"].includes(config[b.id]?.kind),
  );
  return (
    <section className="cam-coupling" aria-label="Assembly coupling">
      <h3>Assembly coupling</h3>
      <p>
        Apply the study’s lift curve to a sliding body. The follower moves when
        its cam rotates in the 3D assembly.
      </p>
      {!follower || !cams.length ? (
        <p>
          Give one body a revolute joint and another a slider on the same axis
          and parent. Screw and cylindrical joints can also drive a cam.
        </p>
      ) : null}
      {follower && (cams.length > 0 || config[follower.id]?.cam) && (
        <>
          <label>
            Follower body
            <select
              aria-label="Follower body"
              value={follower.id}
              onChange={(e) => setChoice(e.target.value)}
            >
              {sliders.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <CouplingForm
            {...props}
            key={JSON.stringify([follower.id, config[follower.id].cam])}
            followerId={follower.id}
            candidates={cams}
          />
        </>
      )}
      {onOpenAssembly && (
        <button className="outline-btn" type="button" onClick={onOpenAssembly}>
          Open 3D assembly
        </button>
      )}
    </section>
  );
}

function CouplingForm({
  project,
  features,
  values,
  onChange,
  law,
  threadFrames,
  followerId,
  candidates,
}: Props & { followerId: string; candidates: WorkspaceProps["features"] }) {
  const config: JointConfig = project.workspaces?.joints || {},
    slider = config[followerId];
  const existing = slider.cam;
  const [driver, setDriver] = useState(
    existing?.driver ??
      candidates.find(
        (b) =>
          config[b.id].axis === slider.axis &&
          config[b.id].parent === slider.parent,
      )?.id ??
      candidates[0]?.id ??
      "",
  );
  const [datum, setDatum] = useState(existing?.datum ?? "0 mm"),
    [phase, setPhase] = useState(existing?.phase ?? "0 deg");
  const [direction, setDirection] = useState<1 | -1>(existing?.direction ?? 1),
    [spring, setSpring] = useState(existing?.springEnabled ?? true);
  const [error, setError] = useState("");
  function commit(cam: CamLink | undefined) {
    const joint = { ...slider };
    if (cam) joint.cam = cam;
    else delete joint.cam;
    const next = { ...config, [followerId]: joint };
    if (cam) {
      try {
        if (!candidates.some((b) => b.id === cam.driver))
          throw Error(
            "Choose a body with a revolute, screw, or cylindrical joint.",
          );
        const ids = bodyIds(features),
          poses = project.workspaces?.jointPose || {};
        const usedDrivers = Object.values(next).flatMap((j) =>
          j.cam ? [j.cam.driver] : [],
        );
        if (
          !threadFrames?.length &&
          usedDrivers.some((id) => next[id]?.threadMate)
        )
          throw Error(
            "Open 3D assembly to load the thread frames, then return to couple this cam.",
          );
        const resolved = resolveThreadMates(
          next,
          threadFrames || [],
          values,
          usedDrivers,
        );
        const current = assemblyCamReadings(ids, resolved, poses, values).find(
          (r) => r.followerId === followerId,
        );
        if (current?.error) throw Error(current.error);
        buildPoses(ids, resolved, poses, values);
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    setError("");
    onChange({
      ...project,
      workspaces: { ...project.workspaces, joints: next },
    });
  }
  return (
    <>
      <label>
        Cam driver
        <select
          aria-label="Cam driver"
          value={driver}
          onChange={(e) => setDriver(e.target.value)}
        >
          {!candidates.some((b) => b.id === driver) && (
            <option value={driver}>Choose a rotating body</option>
          )}
          {candidates.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <details>
        <summary>Follower setup</summary>
        <label>
          Follower zero
          <input
            aria-label="Follower zero"
            value={datum}
            onChange={(e) => setDatum(e.target.value)}
          />
        </label>
        <label>
          Cam phase offset
          <input
            aria-label="Cam phase offset"
            value={phase}
            onChange={(e) => setPhase(e.target.value)}
          />
        </label>
        <label>
          Lift direction
          <select
            aria-label="Lift direction"
            value={direction}
            onChange={(e) => setDirection(Number(e.target.value) as 1 | -1)}
          >
            <option value={1}>Positive {slider.axis}</option>
            <option value={-1}>Negative {slider.axis}</option>
          </select>
        </label>
        <label className="cam-spring-check">
          <input
            type="checkbox"
            checked={spring}
            onChange={(e) => setSpring(e.target.checked)}
          />
          Use the study’s compression spring
        </label>
      </details>
      <p>
        The coupling stores this study’s expressions. Named parameters update
        the motion. For a translating driver, its axial travel also moves the
        follower.
      </p>
      {slider.spring && (
        <p>
          While coupled, this slider uses the cam’s spring settings. Unlinking
          restores its independent spring.
        </p>
      )}
      <div className="cam-coupling-actions">
        <button
          type="button"
          className="primary"
          onClick={() =>
            commit({
              driver,
              law: { ...law },
              datum,
              phase,
              direction,
              springEnabled: spring,
            })
          }
        >
          {existing ? "Update coupling" : "Couple bodies"}
        </button>
        {existing && (
          <button
            type="button"
            className="outline-btn"
            onClick={() => commit(undefined)}
          >
            Unlink cam
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="tm-inline-error">
          {error}
        </p>
      )}
      {existing && (
        <p role="status">
          Linked to{" "}
          {features.find((f) => f.id === existing.driver)?.name ||
            "a missing cam driver"}
          .
        </p>
      )}
    </>
  );
}
