import { CollectionAlbum } from "@/components/collection-album";
import { SetupNotice } from "@/components/setup-notice";
import { getCollection, type Collection } from "@/lib/collection-db";

/** Ranks move with every answer, so the album is always read fresh. */
export const dynamic = "force-dynamic";

export default async function CollectionPage() {
  let data: Collection;
  try {
    data = await getCollection();
  } catch (error) {
    return <SetupNotice error={error} />;
  }
  return <CollectionAlbum data={data} />;
}
