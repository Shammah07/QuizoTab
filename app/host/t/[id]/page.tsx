import { SpectatorPage } from "@/components/host/spectator-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tournament" };

export default async function Page({ params, searchParams }: PageProps<"/host/t/[id]">) {
  const { id } = await params;
  const { room } = await searchParams;
  return <SpectatorPage accessKey={id} section="overview" room={room} />;
}
