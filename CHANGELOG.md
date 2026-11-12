# Nhật ký thay đổi

## 12/11/2026 (chiều) – Quét thư mục tự bỏ mục không còn file (cả tab Nhạc và SFX)
- Lỗi anh báo: đổi sang thư mục SFX khác vẫn còn mục của thư mục cũ (ví dụ 03_SFX hiện 973 mục, trong đó 804 mục
  "01 Tonal Sounds" của 05_Tonal SFX). Bản sáng chỉ dọn khi chọn thư mục KHÁC thư mục đang lưu, và chỉ ở tab SFX.
- Sửa: `scanFolder` (main.js) trả thêm `missing` = mục trong danh sách không có trong thư mục và không còn file trên ổ.
  `scanTab()` (index.html) bỏ các mục đó rồi thêm file mới, dùng chung cho tab Nhạc và SFX, cho nút "Quét thư mục"
  và nút 📁 (chọn thư mục là quét luôn, kể cả chọn lại đúng thư mục cũ). Bỏ `SFX_CARRY`.
- An toàn: bỏ từ 20 mục và hơn một nửa danh sách thì hỏi lại; thư mục không tồn tại (ổ chưa cắm) thì không bỏ gì.
  Bài đang phát bị bỏ thì dừng phát.
- Next/Prev: dòng bài đang phát bị thanh phát nhạc ở đáy che (cuộn kiểu "nearest" tưởng đã hiện đủ).
  Giờ tự tính phần bị footer che; dòng bị che thì cuộn về giữa danh sách.

## 12/11/2026 (trưa) – Các mục anh duyệt + Multicam tới 9 máy
- Tab SFX chỉ dùng một thư mục: chọn thư mục SFX khác thì bỏ danh sách cũ và tự quét thư mục mới. File trùng đường dẫn con
  (chuyển nguyên thư mục sang ổ khác) giữ tag, yêu thích, In/Out, năng lượng và không phân tích lại. Tab Nhạc giữ như cũ.
- Phân tích tab SFX chỉ đo năng lượng (`analyze_music.py` chế độ `sfx`, đọc tối đa 30 giây, bỏ BPM/Highlight).
  File danh sách gửi cho Python giờ là `{"mode", "paths"}`; danh sách kiểu cũ vẫn đọc được.
- Windows: thử `py -3` trước `python`; nhận ra lệnh `python` giả của Microsoft Store (mã 9009) thì thử lệnh kế tiếp,
  áp dụng cho phân tích BPM, Audio Sync và Multicam.
- Phím Space / I / O chỉ nhận ở tab Nhạc/SFX, bỏ qua khi giữ Ctrl/Alt/Cmd.
- Phát / dừng / Next chỉ cập nhật dòng đang phát và dòng vừa dừng (`markPlaying`), không vẽ lại cả danh sách.
- Sóng âm: `main.js` tính 1000 điểm (`lib:peaks`). WAV/BWF PCM 16/24/32-bit và float đọc thẳng từ đĩa, không giới hạn
  dung lượng. File khác ≤ 80MB vẫn giải mã ở giao diện rồi gửi lại điểm để lưu. Cache ở `Documents\MusicPanel\wave_cache`.
  Bỏ IPC `lib:read` / `readFile`.
- Multicam: tối đa 9 máy (nút "+ Thêm máy", "Tự chia theo tên file" lấy tới 9 nhóm). Chia màn hình 2×1, 2×2, 3×2, 3×3,
  giữ tỉ lệ khung. Số cho 2 và 4 máy giữ đúng như đã thử trên Resolve thật; 5–9 máy chưa thử trên Resolve.
- Đã thử: trình đọc sóng âm WAV với file giả (16-bit stereo, 24-bit có chunk bext, float extensible); cú pháp JS/Python.
  Chưa thử trên Resolve thật: đổi thư mục SFX, sóng âm, Multicam 5+ máy.
- Rà lại bằng Claude Code (12/11 chiều), sửa thêm 2 chỗ:
  - `syncApply`: độ dài clip vừa đặt lấy bằng `GetDuration()` thay vì `GetEnd() - GetStart()` (bên VideoAI đã đo: không dùng `GetEnd`).
  - Đổi thư mục SFX: nếu lần quét thư mục mới bị lỗi thì vẫn giữ danh sách mục cũ (`SFX_CARRY`) cho lần quét sau, không mất tag.
  - Kiểm tra: biên dịch thử main.js / preload.js / script index.html, `py_compile` 4 file .py; chạy thử `analyze_music.py`
    chế độ `sfx` trên 2 file trong `D:\05_Tonal SFX` (879 file) và danh sách kiểu cũ; số Pan/Tilt/Zoom của lưới 2 và 4 máy
    đúng như đã thử trên Resolve (∓480 / ±270 / 0.5). Đã chép main.js, preload.js, index.html, analyze_music.py vào thư mục plugin.

## 12/11/2026 – Rà soát toàn bộ dự án, sửa các lỗi chắc chắn
- `main.js` – chế độ "Recorder → máy quay" (`syncApply`):
  - Đặt NGUYÊN clip máy quay (`startFrame 0`, `endFrame = Frames`), giống Multicam. Trước đây clip có In/Out trong
    Media Pool bị cắt ngắn, nên audio Recorder lệch và timeline có khoảng trống.
  - Vị trí clip kế tiếp lấy theo độ dài thật của clip vừa đặt (`GetEnd - GetStart`), không ước lượng từ giây.
  - Đoạn Recorder: `endFrame` không tính (trước thiếu 1 frame); khi offset âm thì rút ngắn đoạn Recorder đúng phần đẩy lùi
    để không lấn sang clip sau.
  - Xóa code thừa: hàm `findClip()` và IPC `lib:stat` / `fileTimes` (không chỗ nào dùng).
- `index.html`:
  - `full(t, tab)`: khi gọi `full(x, "music")` lúc đang ở tab SFX trước đây vẫn ghép theo thư mục SFX → kết quả phân tích BPM
    của bài nhạc không khớp được nếu anh chuyển sang tab SFX trong lúc đang phân tích. Giờ theo đúng tab truyền vào.
  - `applyClass`: gắn mood theo việc file thuộc danh sách Nhạc, không theo tab đang mở.
  - Quét thư mục: vẽ lại danh sách một lần sau khi thêm hết file (trước vẽ lại sau từng file, rất chậm với 879 SFX).
  - Phân tích: gom lưu `library.json` (2 giây) và vẽ lại (0,4 giây) thay vì ghi file + vẽ lại sau từng file; lưu chắc chắn khi xong.
- `install_windows.bat`: thêm dấu nháy cho đường dẫn khi xin quyền Admin (đường dẫn có dấu cách như "Kho dữ liệu" trước đây
  có thể không mở lại được); xóa `__pycache__` nếu lỡ bị chép vào thư mục plugin.
- `CLAUDE.md`: cập nhật thư mục SFX hiện dùng là `D:\05_Tonal SFX`.
- Chưa kiểm tra trên Resolve thật: cần thử lại chế độ "Recorder → máy quay" với clip có In/Out.

## 08/11/2026 (tối) – Đóng gói bản v3
- Tạo 2 bản zip từ code hiện tại, lưu ở `E:\Kho dữ liệu\Tài nguyên\` (KHÔNG đưa vào repo):
  - `Music_Library_Panel_v3.zip`: bản đầy đủ, giữ sẵn danh sách 227 bài (biến `SEED` trong `index.html`, giống bản v2 đầy đủ).
  - `Music_Library_Panel_v3_ban_sach.zip`: danh sách nhạc trống (`const SEED = [];`), dùng cho máy khác.
  - Mỗi bản 13 file: thư mục `Music_Library_Plugin` (9 file, có `multicam_sync.py`) + 2 file cài + 2 file hướng dẫn.
    Không có `WorkflowIntegration.node`, `library.json`, `python_path.txt`, `__pycache__`.
    `install_mac.command` giữ xuống dòng LF và quyền chạy.
  - Đã giải nén thử cả 2 bản: đủ file, không có file cấm, 12 file giống hệt repo, zip không lỗi.
- README_CAI_DAT.txt và LUU_Y_KHI_CAI_PANEL.txt: thêm phần chế độ "Nhiều máy quay" + Recorder (A3, bản -12dB ở A4),
  thư viện Python gộp một lệnh `pip install librosa numpy imageio-ffmpeg`, thư mục plugin giờ có 10 file,
  gọi máy ghi âm rời là "Recorder".

## 08/11/2026 (chiều) – Nhiều file Recorder, đặt ở A3
- Đã kiểm tra timeline anh dựng bằng panel trên Resolve thật (`multicam_01_Sync Cam`): 222/222 clip trùng vị trí
  từng frame với timeline 08/11, cùng màu, cùng độ dài, 0 khoảng trống.
- Hàng Recorder nhận nhiều file (Cả bin / Clip đang chọn / File…), tự ghép cặp bản thường `…S12` và bản -12dB `…S34D12`;
  chỉ phân tích bản thường. Chế độ "Recorder → máy quay" cũng nhận cả bin và tự bỏ bản -12dB.
- `multicam_sync.py`: Recorder là một "máy" chỉ có audio. Không dùng giờ của Recorder để chỉnh giờ máy (kết quả máy quay
  không đổi khi không có Recorder: chạy lại 2 buổi vẫn y hệt 08/11). Recorder không khớp clip nào thì bỏ.
  Bật Gap lại: Recorder bị cắt theo các đoạn có máy quay (trả về từng đoạn: giây bắt đầu trong file + độ dài).
  Bảng kết quả ghi clip nào "Khớp qua Recorder".
- Dựng timeline: Recorder ở A(số máy + 1) màu Teal, tùy chọn bản -12dB ở track kế tiếp màu Navy. File audio có Frames rỗng:
  startFrame/endFrame tính theo frame timeline, endFrame không tính. Đặt máy quay trước, Recorder sau; đoạn Recorder được cắt
  gọn trong đoạn có máy quay, chạm đoạn trước thì cắt bớt đầu (không đẩy lùi) để tiếng không lệch hình.
- "Tự chia theo tên file" chia theo bin con khi bin có bin con (Cam 1 / Cam 2).
- Đã thử bằng giả lập Resolve với Tiệc tối + 07_audio: 6 bản ghi / 12 file nhận đúng cặp; 3 bản ghi khớp (0262, 0263, 0264),
  3 bản không khớp (0259, 0260, 0261: không có cặp nào đạt ngưỡng); xanh lá 41 → 76; 101 đoạn Recorder ở A3, A4 trùng vị trí A3;
  0 khoảng trống, 0 cụm lệch, 0 đoạn Recorder lấn ra ngoài. Tắt Gap lại: 3 file nguyên, 0 cụm lệch.
- Đã thử trên Resolve thật (anh dựng `multicam_02_Sync Cam` bằng panel): 417 clip 76/45/296 đúng từng clip so với phân tích,
  A3 "Recorder" 101 đoạn Teal, 113,6 phút, 0 khoảng trống, 0 đoạn Recorder lấn ra ngoài; 68 chỗ video và Recorder phát cùng lúc
  lệch 0 frame (52) hoặc 1 frame (16). Chưa thử ô "Kèm bản -12dB" (A4) trên Resolve thật.

## 08/11/2026 – Multicam Sync trong tab Audio Sync
- Tab Audio Sync có 2 chế độ: "Recorder → máy quay" (chức năng cũ, đổi tên) và "Nhiều máy quay" (mới).
  Giao diện không còn chữ "Tascam"; máy ghi âm rời gọi chung là "Recorder".
- `multicam_sync.py` (bộ ghép 08/11) chép vào plugin, giữ nguyên thuật toán và ngưỡng. Thêm: tự tìm
  `sync_engine.py` cạnh nó, tham số `close_gaps` (công tắc Gap lại), hàng Recorder làm trục chính.
  Chạy lại 2 buổi NgocQuynh cho kết quả y hệt 08/11 (222 và 417 clip, không clip nào khác vị trí/màu).
- Nhiều máy quay: 2–4 máy + Recorder; nút Tự chia theo tên file / Cả bin / Clip đang chọn / File…;
  Sync bằng audio (có "Dùng giờ máy đã chỉnh") hoặc bằng timecode (Start TC); công tắc Gap lại, Chia màn hình;
  bảng kết quả, Xuất CSV, Tạo timeline (bin 03_timeline, không ghi đè timeline trùng tên).
- Dựng timeline theo bài học 08/11: startFrame 0, endFrame = Frames; dồn khe 1–2 frame; Pan ∓480;
  lưới 2×2 thêm Tilt ±270 (đã thử dấu trên Resolve thật: Tilt +270 = hàng trên); tô màu, đặt tên track;
  tự kiểm tra khoảng trống và cụm lệch sau khi dựng.
- Tab Nhạc: bấm Next/Prev thì danh sách tự cuộn tới bài đang phát.
- Đã thử: chạy main.js trong môi trường giả lập Resolve (Python thật, footage thật). Lễ sáng 222/222 clip
  trùng vị trí từng frame với timeline 08/11; Tiệc tối 417 clip lệch tối đa 1 frame; cùng màu, cùng độ dài,
  0 khoảng trống. Thử thêm: tắt Gap lại, tắt Chia màn hình, 3 máy, timecode, Recorder, trùng tên.
  Giả lập bắt được 1 lỗi (lấy nhầm clip từ chỉ mục Media Pool), đã sửa.
- CHƯA thử bấm trong panel trên Resolve thật.

## 04/11/2026
- Đưa mã nguồn lên GitHub (kho riêng tư `quangdung94-coder/Music_Library_Panel`).
- Thêm `CLAUDE.md`: quy trình cuối mỗi lần sửa (CHANGELOG, cài vào Resolve, GitHub, Notion).

## 03/11/2026
- Chặn import trùng theo bin: file đã có trong 02_music / 03_sfx (kể cả bin con) hoặc chỗ khác trong Media Pool
  thì báo "đã tồn tại trong bin …". + Media bỏ qua file đó; + Timeline dừng hẳn, không đặt vào timeline.
- Đã chép `main.js` vào thư mục plugin. Chưa thử trên Resolve thật.
