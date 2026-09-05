# Label role map

Ship-it resolves lifecycle and category roles through this map. Category labels already exist in GitHub. Lifecycle and chaos labels are the conventional names to provision before the first `/do-task`; groundwork does not create remote labels.

```yaml
ready-for-agent: ready-for-agent
in-progress: in-progress
in-review: in-review
needs-human: needs-human
category:feature: enhancement
category:fix: bug
chaos:passed: chaos:passed
chaos:found-bugs: chaos:found-bugs
required: []
```
