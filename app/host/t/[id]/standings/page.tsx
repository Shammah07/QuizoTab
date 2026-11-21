import { SpectatorPage } from "@/components/host/spectator-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Standings" };

export default async function Page({ params, searchParams }: PageProps<"/host/t/[id]/standings">) {
  const { id } = await params;
  const { room } = await searchParams;
  return <SpectatorPage accessKey={id} section="standings" room={room} />;
}
