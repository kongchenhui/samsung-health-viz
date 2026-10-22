// 坐标基准判定的自检脚本（node scripts/check-coord-sys.mjs）
// 修改 core/coord-sys.mjs 后先跑这里，确认判定顺序没被改坏。
import assert from 'node:assert/strict';
import { COORD_SYS, buildDeviceIndex, isWearableDevice, detectCoordSys } from '../src/core/coord-sys.mjs';

// device_profile.csv 记录 → 索引
const index = buildDeviceIndex([
  { deviceuuid: 'watch', device_type: '10061', name: 'Galaxy Watch7', model: 'SM-L310' },
  { deviceuuid: 'phone', device_type: '', name: 'Galaxy S23', model: 'SM-S9110' },
  { deviceuuid: 'pseudo', device_type: '', name: 'Combined', model: '' },
]);

const watch = index.get('watch');
const phone = index.get('phone');

// 1. 穿戴设备识别
assert.equal(isWearableDevice(watch), true, 'device_type=10061 应识别为手表');
assert.equal(isWearableDevice({ type: '', name: 'Galaxy Watch8', model: '' }), true, 'name 含 Watch');
assert.equal(isWearableDevice({ type: '', name: '', model: 'SM-L7050' }), true, 'model 以 SM-L 开头');
assert.equal(isWearableDevice(phone), false, '手机不是穿戴设备');
assert.equal(isWearableDevice(undefined), false, '未知设备按非穿戴处理');

// 2. 判定顺序：点格式（version）优先，其次设备类型
assert.equal(detectCoordSys(watch, [{ latitude: 31 }]), COORD_SYS.WGS84, '手表轨迹无 version → WGS-84');
assert.equal(detectCoordSys(watch, [{ latitude: 31, version: 2 }]), COORD_SYS.GCJ02, '带 version 的手机格式优先 → GCJ-02');
assert.equal(detectCoordSys(phone, [{ latitude: 31, version: 2 }]), COORD_SYS.GCJ02, '手机轨迹带 version → GCJ-02');
assert.equal(detectCoordSys(phone, [{ latitude: 31 }]), COORD_SYS.GCJ02, '手机轨迹无 version 时按设备回退 → GCJ-02');
assert.equal(detectCoordSys(undefined, null), COORD_SYS.GCJ02, '无设备信息默认按手机 → GCJ-02');
assert.equal(detectCoordSys(watch, null), COORD_SYS.WGS84, '手表无轨迹时按设备回退 → WGS-84');

console.log('coord-sys 自检通过：6 个判定用例全部符合预期');
