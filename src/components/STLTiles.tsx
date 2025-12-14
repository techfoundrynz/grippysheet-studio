import React, { useMemo } from 'react';
import { Instances, Instance } from '@react-three/drei';
import * as THREE from 'three';

interface STLTilesProps {
  instances: any[];
  geometry: THREE.BufferGeometry;
  color: string;
  wireframe: boolean;
  thickness: number;
  transparent?: boolean;
  opacity?: number;
}

const STLTiles: React.FC<STLTilesProps> = React.memo(({ instances, geometry, color, wireframe, thickness, opacity }) => {
    const offset = useMemo(() => {
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        const zHeight = box.max.z - box.min.z;
        return zHeight / 2;
    }, [geometry]);

    return (
        <Instances
            range={instances.length}
            geometry={geometry}
            // Overlap base by 0.01mm for manifold export
            position={[0, 0, thickness - 0.01]} 
        >
            <meshStandardMaterial color={color} wireframe={wireframe} transparent={!!opacity} opacity={opacity} />
            {instances.map((data, i) => (
                <Instance
                    key={i}
                    position={[data.position.x, data.position.y, offset * data.scale]} 
                    rotation={[0, 0, data.rotation]}
                    scale={[data.scale, data.scale, data.scale]}
                />
            ))}
        </Instances>
    );
});

export default STLTiles;
