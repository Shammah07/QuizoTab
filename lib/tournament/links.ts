import { site } from "@/lib/site";

// The addresses people share: the audience page and the judge portal of a tournament

export const audienceUrl = (tournamentId: string) => `${site.url}/host/t/${tournamentId}`;
export const judgeUrl = (tournamentId: string) => `${site.url}/host/${tournamentId}/judge`;
