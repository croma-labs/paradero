import { useLocalSearchParams } from "expo-router";
import { useRef } from "react";

import { DetailScreen } from "@/components/detail-screen";
import { SaveButton } from "@/components/save-button";
import { StopDetails, useSaveStop, useStopView } from "@/components/stop-details";
import { TransitMap } from "@/components/transit-map";
import type { MapHandle } from "@/components/transit-map.types";
import { useT } from "@/i18n";
import { useIsSaved } from "@/lib/saved";
import { layout } from "@/theme/tokens";

export default function StopScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const map = useRef<MapHandle>(null);
  const view = useStopView(id, map);
  const { data, stop } = view;
  const saved = useIsSaved("stop", id);
  const save = useSaveStop();

  return (
    <>
      {data && <SaveButton saved={saved} label={saved ? t.stop.unsave : t.stop.save} onPress={() => save(data.stop)} />}

      <DetailScreen
        map={stop && <TransitMap ref={map} center={{ lat: stop.lat, lon: stop.lon }} zoom={15.5} stops={[stop]} {...view.mapProps} padding={layout.mapInset} />}>
        <StopDetails view={view} />
      </DetailScreen>
    </>
  );
}
