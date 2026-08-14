const PRE_MISSION = [
  "Calibrating orbital beacons",
  "Warming up jump drives",
  "Calculating hyperspace lanes",
  "Synchronizing fleet clocks",
  "Unlocking sealed briefcases",
  "Briefing command on Delta protocols",
  "Scanning for clear LZ",
  "Arming the retrieval drones",
];

const IN_FLIGHT = [
  "Delta approaching",
  "Retrieving squads",
  "Sending forces to Delta B",
  "Rallying strike teams",
  "Escorting the payload home",
  "Holding formation through turbulence",
  "Pulling crates from deep storage",
  "Routing convoys through the fog",
  "Extracting the package under cover",
  "Troops advancing on the drop zone",
  "Reinforcements inbound",
  "Securing the perimeter mid-transfer",
  "Boosting thrusters for final approach",
  "Catching the supply drop mid-air",
  "Marching bytes across the trench",
  "Calling in the heavy lift",
];

const POST_MISSION = [
  "Unpacking the cargo hold",
  "Debriefing the squad",
  "Stowing gear in the armory",
  "Hydrating the field units",
  "Wiring the forward operating base",
  "Mission complete — standing down",
];

function pick(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)] || list[0];
}

function formatTroopMass(bytes: number): string {
  if (bytes <= 0) return "0 Mb";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Kb`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mb`;
}

export type MissionPhase = "briefing" | "transfer" | "secure";

export function missionStatus(
  phase: MissionPhase,
  opts?: { percent?: number; receivedBytes?: number; totalBytes?: number }
): string {
  if (phase === "briefing") return pick(PRE_MISSION);
  if (phase === "secure") return pick(POST_MISSION);

  const percent = Math.max(0, Math.min(100, opts?.percent ?? 0));
  const received = opts?.receivedBytes ?? 0;
  const total = opts?.totalBytes ?? 0;
  const line = pick(IN_FLIGHT);
  if (total > 0) {
    return `${line} · ${percent}% · Troops are ${formatTroopMass(received)} / ${formatTroopMass(total)}`;
  }
  return `${line} · Troops are ${formatTroopMass(received)}`;
}

export function missionStartBanner(clientOnly: boolean): string {
  return clientOnly
    ? "Launching Delta retrieval"
    : "Launching dual-front retrieval";
}

export function missionDoneBanner(clientOnly: boolean, versions: {
  server?: string;
  client: string;
}): string {
  return clientOnly
    ? `Delta secured · client ${versions.client}`
    : `Both fronts secured · server ${versions.server} · client ${versions.client}`;
}
