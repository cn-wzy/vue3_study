const s = new Set([1, 2, 3])
const  p = new Proxy(s, {
    get(target, key, receiver) {
        if (key === 'size') {
            // 此处体现了为什么要使用Reflect的原因，改变this指向
            return Reflect.get(target, key, target)
        }
        return target[key].bing(target)
    }
})