# Credits

SwarmWatch의 커서 기반 개발 시각화는 아래 두 프로젝트의 공개된 시각적 아이디어에서 영감을 받았습니다. 원작자와 참고 프로젝트의 기여를 명확히 밝힙니다.

## 원작과 참고 프로젝트

- **Joel Califa — Swarm**: 웹사이트가 스크롤에 따라 커서들에 의해 만들어지는 시각적 콘셉트의 원작입니다. [작품](https://califa.github.io/swarm-site/) · [저장소](https://github.com/califa/swarm-site) · [작가](https://joelcalifa.com/) · [GitHub @califa](https://github.com/califa)
- **Dhvanil / @DhvanilPatel — Swarm Rebuild (`swarm-cursors`)**: 기존 페이지를 DOM 스냅샷으로 분석하고 커서가 다시 만드는 Chrome 확장입니다. SwarmWatch가 직접 조사한 참고 프로젝트입니다. 이 프로젝트의 README도 시각적 모션 콘셉트의 출처를 Joel Califa의 Swarm으로 명시합니다. [저장소](https://github.com/DhvanilPatel/swarm-cursors) · [개발자 GitHub](https://github.com/DhvanilPatel)

2026-11-17 확인 기준, DhvanilPatel의 공개 GitHub profile 표시 이름은 **Dhvanil**, 계정명은 **DhvanilPatel**입니다. Joel Califa의 공개 profile과 참고 프로젝트 README의 표기가 일치함을 확인했습니다. 참고 저장소의 검토 commit은 `eef4b5e38dcfe30064d5272d8ce5ee738d855f80`이며, 상세한 기술 조사 범위는 [참고 프로젝트 분석](reference-analysis.md)에 기록했습니다.

## 독립 구현과 라이선스 범위

SwarmWatch는 두 프로젝트의 코드, 애니메이션 엔진, 이미지, 영상, 아이콘, 글꼴 또는 기타 에셋을 복사·포함하지 않습니다. 파일 관찰, 공식 agent event adapter, Vite instrumentation, HMR·DOM correlation, 로컬 전송·저장·Replay 및 dashboard는 SwarmWatch용으로 독립 구현했습니다.

검토 당시 `swarm-cursors` README는 라이선스를 **“None yet”**로 표시하며 원래 Swarm site도 라이선스 없이 공개되어 있다고 설명합니다. 별도로 확인한 `califa/swarm-site` checkout에도 명시적인 LICENSE 파일은 없었습니다. 공개 열람과 출처 표시는 재사용 허락을 뜻하지 않습니다.

SwarmWatch의 [MIT License](../LICENSE)는 이 저장소의 독립 작성 부분에 적용됩니다. 참고 프로젝트를 MIT로 재허가하거나 해당 원작의 사용 권한을 부여하지 않습니다. 설치된 제3자 dependency는 각각의 라이선스를 따릅니다. [Third-party notices](third-party-notices.md)를 함께 확인하세요.

이 출처 표시는 원작자의 SwarmWatch 참여, 검토 또는 보증을 의미하지 않습니다.

## PR·릴리스에 사용할 짧은 문구

> SwarmWatch's cursor-based visual language is inspired by **Swarm by Joel Califa** ([site](https://califa.github.io/swarm-site/), [source](https://github.com/califa/swarm-site)) and **Swarm Rebuild / swarm-cursors by Dhvanil (@DhvanilPatel)** ([source](https://github.com/DhvanilPatel/swarm-cursors)). SwarmWatch is an independent implementation: it does not include code or assets from either reference. Those references had no explicit reuse license at the time reviewed; SwarmWatch's MIT license applies to its independently authored implementation and does not relicense the references. Third-party dependencies retain their own licenses.
