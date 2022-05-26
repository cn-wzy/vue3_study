// 虚拟dom
const vnode = {
    tag: 'div',
    props: {
        onClick:  () => alert('hello')
    },
    children: 'click me'
}


// 简易的渲染器
function renderer(vnode, container) {
    if (typeof vnode.tag === 'string') {
        mountElement(vnode, container)
    } else if (typeof vnode.tag === 'object') {
        mountComponent(vnode, container)
    }
}

function mountElement(vnode, container) {
    // 使用tag为标签名称创建DOM元素
    const el = document.createElement(vnode.tag)
    // 编译props，将所有属性和事件添加到dom元素中
    for (const key in vnode.props) {
        // 判断开头是on的代表是事件
        if (/^on/.test(key)) {
            el.addEventListener( // 绑定事件
                key.substring(2).toLowerCase(),
                vnode.props[key]
            )
        }
        
        // 处理children
        if (typeof vnode.children === 'string') {
            el.appendChild(document.createTextNode(vnode.children))
        } else if (Array.isArray(vnode.children)) {
            // 递归调用renderer函数渲染子节点，使用当前元素el作为挂载点
            vnode.children.forEach(child => el.renderer(child, el))
        }

        // 将元素添加到挂载点下
        container.appendChild(el)
    }
}

function mountComponent(vnode, container) {
    const subtree = vnode.tag.render()
    renderer(subtree, container)
}