import type { CamReading } from "./kinematics";

export default function CamReadout({
  readings,
  selected,
  names,
  onSelectDriver,
}: {
  readings: CamReading[];
  selected: string;
  names: Record<string, string>;
  onSelectDriver: (id: string) => void;
}) {
  return (
    <>
      {readings
        .filter((r) => r.driverId === selected || r.followerId === selected)
        .map((r) => (
          <section
            className="cam-readout"
            key={r.followerId}
            aria-label="Cam coupling"
          >
            <h3>Follower · {names[r.followerId]}</h3>
            <dl>
              <div>
                <dt>Slider position</dt>
                <dd>{r.position.toFixed(3)} mm</dd>
              </div>
              {r.springEnabled && (
                <div>
                  <dt>Closing spring</dt>
                  <dd>{r.sample.spring.toFixed(3)} N</dd>
                </div>
              )}
              <div>
                <dt>Cam phase</dt>
                <dd>{r.sample.event}</dd>
              </div>
              <div>
                <dt>Contact</dt>
                <dd>
                  {r.error
                    ? "Infeasible"
                    : r.sample.state === "Contact"
                      ? "Prescribed"
                      : r.sample.state}
                </dd>
              </div>
            </dl>
            {selected === r.followerId && (
              <button
                type="button"
                className="outline-btn"
                onClick={() => onSelectDriver(r.driverId)}
              >
                Drive {names[r.driverId]}
              </button>
            )}
          </section>
        ))}
    </>
  );
}
