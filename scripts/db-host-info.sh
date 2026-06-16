#!/usr/bin/env bash
# db-host-info.sh, system-level facts about the Postgres host that
# Postgres itself cannot report: CPU, RAM, and crucially the DISK type
# and its IOPS characteristics.
#
# The leading root-cause hypothesis is that the DB lives on IOPS-limited
# virtual / network-attached block storage (xvda = Xen virtual disk seen
# in glances), so heavy analytical scans blow past the IOPS budget and
# everything queues behind disk waits. This confirms or kills that.
#
# RUN THIS ON THE POSTGRES HOST (10.42.44.182), not the app VM:
#   bash db-host-info.sh
#
# If you cannot SSH to .182 directly, run it on whatever host the
# postgres process actually lives on. Everything here is read-only.

echo "############ CPU ############"
nproc
lscpu 2>/dev/null | grep -E 'Model name|^CPU\(s\)|Thread|Core|Socket' || true

echo
echo "############ MEMORY ############"
free -h

echo
echo "############ DISK DEVICES (rota=1 spinning, rota=0 SSD/virtual) ############"
lsblk -d -o NAME,ROTA,SIZE,TYPE,MODEL 2>/dev/null || lsblk 2>/dev/null

echo
echo "############ FILESYSTEM USAGE ############"
df -hT / /var/lib/postgresql 2>/dev/null | sort -u

echo
echo "############ IS THE ROOT/PG DISK VIRTUAL OR NETWORK-ATTACHED? ############"
# Xen (xvda) / virtio (vda) / nvme naming hints at the storage class.
ls -l /dev/disk/by-id/ 2>/dev/null | grep -vE 'part' || true
echo "--- rotational flags ---"
for d in /sys/block/xvda /sys/block/vda /sys/block/sda /sys/block/nvme0n1; do
  [ -e "$d/queue/rotational" ] && echo "$(basename "$d"): rotational=$(cat "$d/queue/rotational") scheduler=$(cat "$d/queue/scheduler" 2>/dev/null)"
done

echo
echo "############ CURRENT DISK IO PRESSURE (5 x 1s samples) ############"
# wa column = % time CPU waited on IO. High + sustained = disk-bound.
if command -v vmstat >/dev/null 2>&1; then
  vmstat 1 5
else
  echo "vmstat not installed; try: top -bn1 | grep Cpu"
fi

echo
echo "############ PER-DEVICE IO (if iostat available) ############"
# %util near 100 = device saturated. await = ms per IO (high = slow disk).
if command -v iostat >/dev/null 2>&1; then
  iostat -dx 1 3 2>/dev/null | grep -vE '^$'
else
  echo "iostat not installed. Install with: sudo apt-get install -y sysstat"
  echo "(sysstat is the single most useful tool for confirming a disk-IOPS ceiling)"
fi

echo
echo "############ OPTIONAL: quick random-read IOPS probe (needs fio) ############"
# Uncomment to actually measure the IOPS ceiling. Reads only, 256MB test
# file in the current dir, ~10s. This is the definitive disk-class test.
#
# if command -v fio >/dev/null 2>&1; then
#   fio --name=randread --ioengine=libaio --direct=1 --rw=randread \
#       --bs=8k --numjobs=1 --iodepth=32 --size=256M --runtime=10 \
#       --time_based --group_reporting --filename=./fio_probe.tmp
#   rm -f ./fio_probe.tmp
# else
#   echo "fio not installed. Install with: sudo apt-get install -y fio"
# fi
echo "(fio probe is commented out; uncomment in the script to measure raw IOPS)"

echo
echo "############ DONE ############"
