#!/usr/bin/env python3
"""Repack the legacy terrain's illegal SHORT normals as aligned core-glTF FLOAT.

Geometry, colours and indices are preserved. No quantization extension or
external decoder is needed. Input is the standalone, non-sparse terrain GLB.
"""
import argparse
import json
import math
import struct
from pathlib import Path


def repair(source: Path, target: Path):
    raw = source.read_bytes()
    magic, version, length = struct.unpack_from('<III', raw)
    if magic != 0x46546C67 or version != 2 or length != len(raw):
        raise ValueError('Not a valid GLB container')
    json_size = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20 + json_size])
    binary = raw[28 + json_size:]
    normal_ids = {p['attributes']['NORMAL'] for m in doc['meshes'] for p in m['primitives']}
    index_ids = {p['indices'] for m in doc['meshes'] for p in m['primitives']}
    formats = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
    sizes = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
    output = bytearray()
    views = []
    for aid, accessor in enumerate(doc['accessors']):
        if 'sparse' in accessor:
            raise ValueError('Sparse accessor is not supported by this repair')
        old_view = doc['bufferViews'][accessor['bufferView']]
        fmt = '<' + formats[accessor['componentType']] * sizes[accessor['type']]
        width = struct.calcsize(fmt)
        stride = old_view.get('byteStride', width)
        start = old_view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        values = [struct.unpack_from(fmt, binary, start + i * stride) for i in range(accessor['count'])]
        if aid in normal_ids and accessor['componentType'] == 5122:
            values = [tuple(max(-1, v / 32767) for v in row) for row in values]
            values = [tuple(v / math.sqrt(sum(c * c for c in row)) for v in row) for row in values]
            accessor['componentType'] = 5126
            accessor.pop('normalized', None)
            accessor.pop('min', None)
            accessor.pop('max', None)
            fmt = '<fff'
            width = 12
        while len(output) % 4:
            output.append(0)
        offset = len(output)
        for row in values:
            output.extend(struct.pack(fmt, *row))
        accessor['bufferView'] = len(views)
        accessor['byteOffset'] = 0
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(output) - offset,
                      'target': 34963 if aid in index_ids else 34962})
    doc['bufferViews'] = views
    doc['buffers'] = [{'byteLength': len(output)}]
    doc['asset']['generator'] = 'Origintrailz legacy terrain repair (FLOAT normals, aligned)'
    encoded = json.dumps(doc, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    output += b'\0' * (-len(output) % 4)
    final = struct.pack('<III', 0x46546C67, 2, 28 + len(encoded) + len(output))
    final += struct.pack('<II', len(encoded), 0x4E4F534A) + encoded
    final += struct.pack('<II', len(output), 0x004E4942) + output
    target.write_bytes(final)
    print(f'Repaired {target.name}: {len(final):,} bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('target', type=Path)
    args = parser.parse_args()
    repair(args.source, args.target)
