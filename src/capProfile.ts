export type CapProfile = { prefix: string; crown: "flat" | "domed" | "tapered" };

/** Drop the stored posting choices when their cap or barrel is removed. */
export function remainingCapMounts<T extends { barrelId: string }>(mounts: Record<string, T>, removed: string) {
  return Object.fromEntries(Object.entries(mounts).filter(([id, mount]) => id !== removed && mount?.barrelId !== removed));
}

export function validateCapProfile(profile: CapProfile, values: Record<string, number>) {
  const read = (key: string) => values[profile.prefix + "_" + key];
  const diameter = read("diameter"), crown = profile.crown === "flat" ? 0 : read("crown");
  if (!(diameter > read("major") + 1e-5))
    throw Error("Make the cap outside diameter larger than the thread so the socket has a wall.");
  if (profile.crown !== "flat" && !(crown > 0))
    throw Error("Give the cap crown a positive length.");
  if (profile.crown === "domed" && crown > diameter / 2)
    throw Error("Keep the dome height at or below half the cap diameter for a rounded end.");
  if (!(read("wall") > 0 && read("thread_length") > 0 && read("length") - crown - read("wall") >= read("thread_length")))
    throw Error("Leave room for the threads, end wall and crown. Increase the cap length or shorten one of them.");
}
