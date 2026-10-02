# LoRA 데이터셋 크롤러 (Danbooru)

```
pip install requests pillow
python crawl.py --find kaoruko                  # 정확한 태그명 확인
python crawl.py --tag waguri_kaoruko --count 80
```

결과: `dataset/img/10_kaoruko_waguri/` 에 `이미지.png` + 캡션 `.txt` (kohya_ss 형식)

- 해당 캐릭터 단독 이미지만 저장 (다른 캐릭터 동반, 만화, 흑백, 스케치 제외)
- 짧은 변 768px 미만 제외, 1024px로 축소
- 중복(md5) 제외, 재실행 시 이어서 수집
- 수집 후 직접 훑어보고 이상한 이미지는 지우는 것을 권장
