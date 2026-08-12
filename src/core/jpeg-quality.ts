/**
 * JPEG quality estimation from quantization tables.
 *
 * Algorithm sources:
 * - https://gist.github.com/FranckFreiburger/d8e7445245221c5cf38e69a88f22eeeb (MIT)
 * - Based on ImageMagick's coders/jpeg.c hash tables
 * - Marker parser adapted from jpeg-js (BSD-2-Clause)
 *
 * Returns 1–100 (quality estimate) or null if buffer is not a parseable JPEG.
 */

const DCT_SIZE_2 = 64;
const NUM_QUANT_TBLS = 4;

const DCT_ZIGZAG = new Int32Array([
	0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40,
	48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29,
	22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54,
	47, 55, 62, 63,
]);

// ImageMagick hash arrays — both luminance + chrominance tables present
const HASH_Q01 = [
	1020, 1015, 932, 848, 780, 735, 702, 679, 660, 645, 632, 623, 613, 607, 600,
	594, 589, 585, 581, 571, 555, 542, 529, 514, 494, 474, 457, 439, 424, 410,
	397, 386, 373, 364, 351, 341, 334, 324, 317, 309, 299, 294, 287, 279, 274,
	267, 262, 257, 251, 247, 243, 237, 232, 227, 222, 217, 213, 207, 202, 198,
	192, 188, 183, 177, 173, 168, 163, 157, 153, 148, 143, 139, 132, 128, 125,
	119, 115, 108, 104, 99, 94, 90, 84, 79, 74, 70, 64, 59, 55, 49, 45, 40, 34,
	30, 25, 20, 15, 11, 6, 4, 0,
];
const SUMS_Q01 = [
	32640, 32635, 32266, 31495, 30665, 29804, 29146, 28599, 28104, 27670, 27225,
	26725, 26210, 25716, 25240, 24789, 24373, 23946, 23572, 22846, 21801, 20842,
	19949, 19121, 18386, 17651, 16998, 16349, 15800, 15247, 14783, 14321, 13859,
	13535, 13081, 12702, 12423, 12056, 11779, 11513, 11135, 10955, 10676, 10392,
	10208, 9928, 9747, 9564, 9369, 9193, 9017, 8822, 8639, 8458, 8270, 8084,
	7896, 7710, 7527, 7347, 7156, 6977, 6788, 6607, 6422, 6236, 6054, 5867,
	5684, 5495, 5305, 5128, 4945, 4751, 4638, 4442, 4248, 4065, 3888, 3698,
	3509, 3326, 3139, 2957, 2775, 2586, 2405, 2216, 2037, 1846, 1666, 1483,
	1297, 1109, 927, 735, 554, 375, 201, 128, 0,
];

// Single luminance table
const HASH_Q0 = [
	510, 505, 422, 380, 355, 338, 326, 318, 311, 305, 300, 297, 293, 291, 288,
	286, 284, 283, 281, 280, 279, 278, 277, 273, 262, 251, 243, 233, 225, 218,
	211, 205, 198, 193, 186, 181, 177, 172, 168, 164, 158, 156, 152, 148, 145,
	142, 139, 136, 133, 131, 129, 126, 123, 120, 118, 115, 113, 110, 107, 105,
	102, 100, 97, 94, 92, 89, 87, 83, 81, 79, 76, 74, 70, 68, 66, 63, 61, 57,
	55, 52, 50, 48, 44, 42, 39, 37, 34, 31, 29, 26, 24, 21, 18, 16, 13, 11, 8,
	6, 3, 2, 0,
];
const SUMS_Q0 = [
	16320, 16315, 15946, 15277, 14655, 14073, 13623, 13230, 12859, 12560, 12240,
	11861, 11456, 11081, 10714, 10360, 10027, 9679, 9368, 9056, 8680, 8331,
	7995, 7668, 7376, 7084, 6823, 6562, 6345, 6125, 5939, 5756, 5571, 5421,
	5240, 5086, 4976, 4829, 4719, 4616, 4463, 4393, 4280, 4166, 4092, 3980,
	3909, 3835, 3755, 3688, 3621, 3541, 3467, 3396, 3323, 3247, 3170, 3096,
	3021, 2952, 2874, 2804, 2727, 2657, 2583, 2509, 2437, 2362, 2290, 2211,
	2136, 2068, 1996, 1915, 1858, 1773, 1692, 1620, 1552, 1477, 1398, 1326,
	1251, 1179, 1109, 1031, 961, 884, 814, 736, 667, 592, 518, 441, 369, 292,
	221, 151, 86, 64, 0,
];

function parseQuantizationTables(data: Uint8Array): (Int32Array | null)[] | null {
	const tables: (Int32Array | null)[] = [null, null, null, null];
	let offset = 0;
	const length = data.length;

	const readUint16 = () => {
		const v = (data[offset] << 8) | data[offset + 1];
		offset += 2;
		return v;
	};

	if (length < 4) return null;
	if (readUint16() !== 0xffd8) return null; // SOI

	while (offset < length - 1) {
		const marker = readUint16();
		if (marker === 0xffd9) break; // EOI
		if (marker === 0xffda) break; // SOS (start of scan, no more headers)

		// Markers without payload
		if (marker === 0xff00 || marker === 0xffff) continue;

		// DQT — read quant tables
		if (marker === 0xffdb) {
			const segLen = readUint16();
			const end = offset + segLen - 2;
			while (offset < end && offset < length) {
				const spec = data[offset++];
				const tableId = spec & 0x0f;
				const precision = spec >> 4;
				const tableData = new Int32Array(64);
				if (precision === 0) {
					for (let j = 0; j < 64; j++) {
						if (offset >= length) return null;
						tableData[DCT_ZIGZAG[j]] = data[offset++];
					}
				} else if (precision === 1) {
					for (let j = 0; j < 64; j++) {
						if (offset + 1 >= length) return null;
						tableData[DCT_ZIGZAG[j]] = (data[offset] << 8) | data[offset + 1];
						offset += 2;
					}
				} else {
					return null;
				}
				if (tableId < NUM_QUANT_TBLS) tables[tableId] = tableData;
			}
			continue;
		}

		// Any other marker with payload: skip segLen bytes
		if (marker >= 0xffc0 && marker <= 0xfffe) {
			if (offset + 2 > length) return null;
			const segLen = readUint16();
			offset += segLen - 2;
			continue;
		}

		// Unknown marker — bail
		return null;
	}

	return tables;
}

function qualityFromTables(tables: (Int32Array | null)[]): number | null {
	let sum = 0;
	for (let i = 0; i < NUM_QUANT_TBLS; i++) {
		const t = tables[i];
		if (!t) continue;
		for (let j = 0; j < DCT_SIZE_2; j++) sum += t[j];
	}

	const t0 = tables[0];
	const t1 = tables[1];

	if (t0 && t1) {
		const qvalue = t0[2] + t0[53] + t1[0] + t1[DCT_SIZE_2 - 1];
		for (let i = 0; i < 100; i++) {
			if (qvalue < HASH_Q01[i] && sum < SUMS_Q01[i]) continue;
			if ((qvalue <= HASH_Q01[i] && sum <= SUMS_Q01[i]) || i >= 50)
				return i + 1;
			break;
		}
		return null;
	}

	if (t0) {
		const qvalue = t0[2] + t0[53];
		for (let i = 0; i < 100; i++) {
			if (qvalue < HASH_Q0[i] && sum < SUMS_Q0[i]) continue;
			if ((qvalue <= HASH_Q0[i] && sum <= SUMS_Q0[i]) || i >= 50)
				return i + 1;
			break;
		}
		return null;
	}

	return null;
}

/**
 * Estimate JPEG encoding quality (1–100) from a JPEG file's quantization tables.
 * Returns null if the buffer is not a valid JPEG or quality cannot be determined.
 */
export function estimateJpegQuality(buffer: ArrayBuffer | Uint8Array): number | null {
	const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	try {
		const tables = parseQuantizationTables(data);
		if (!tables) return null;
		return qualityFromTables(tables);
	} catch {
		return null;
	}
}
