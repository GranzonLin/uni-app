const path = require('path')
const webpack = require('webpack')

const {
  getMainEntry,
  isInHBuilderX,
  getPlatformCompiler
} = require('@dcloudio/uni-cli-shared')

const {
  getGlobalUsingComponentsCode
} = require('@dcloudio/uni-cli-shared/lib/pages')

const {
  isUnaryTag,
  getPartialIdentifier
} = require('../util')

// const {
//   createTemplateCacheLoader
// } = require('../cache-loader')

const runtimePath = '@dcloudio/uni-mp-weixin/dist/mp.js'
const wxsPath = '@dcloudio/uni-mp-weixin/dist/wxs.js'

function getProvides (isAppService) {
  if (isAppService) {
    return { // app-service
      '__f__': [path.resolve(__dirname, '../format-log.js'), 'default'],
      'wx': [runtimePath, 'default'],
      'wx.nextTick': [runtimePath, 'nextTick'],
      'Page': [runtimePath, 'Page'],
      'Component': [runtimePath, 'Component'],
      'Behavior': [runtimePath, 'Behavior'],
      'getDate': [wxsPath, 'getDate'],
      'getRegExp': [wxsPath, 'getRegExp']
    }
  }
  return { // app-view
    '__f__': [path.resolve(__dirname, '../format-log.js'), 'default'],
    'getDate': [wxsPath, 'getDate'],
    'getRegExp': [wxsPath, 'getRegExp']
  }
}

const v3 = {
  vueConfig: {
    parallel: false,
    transpileDependencies: [
      wxsPath,
      runtimePath
    ]
  },
  webpackConfig (webpackConfig, vueOptions, api) {
    const isAppService = !!vueOptions.pluginOptions['uni-app-plus']['service']
    const isAppView = !!vueOptions.pluginOptions['uni-app-plus']['view']

    const statCode = process.env.UNI_USING_STAT ? `import '@dcloudio/uni-stat';` : ''

    const beforeCode = `import 'uni-pages';`

    if (!webpackConfig.optimization) {
      webpackConfig.optimization = {}
    }
    // disable noEmitOnErrors
    webpackConfig.optimization.noEmitOnErrors = false

    if (isAppService) {
      webpackConfig.optimization.runtimeChunk = {
        name: 'app-config'
      }
    } else if (isAppView) {
      webpackConfig.optimization.runtimeChunk = false
    }

    webpackConfig.optimization.splitChunks = false

    let devtool = false

    if (isAppService && process.env.NODE_ENV !== 'production') {
      devtool = 'eval-source-map'
    }

    const rules = []

    const scriptLoaders = []
    if (isAppView) {
      scriptLoaders.push({
        loader: path.resolve(__dirname,
          '../../packages/webpack-uni-app-loader/view/script')
      })
    }
    scriptLoaders.push({
      loader: path.resolve(__dirname,
        '../../packages/webpack-uni-app-loader/using-components')
    })
    rules.push({ // 解析组件，css 等
      resourceQuery: /vue&type=script/,
      use: scriptLoaders
    })
    // TODO 临时方案,将 wxs 也编译至 service
    rules.push({
      resourceQuery: [/lang=wxs/, /blockType=wxs/],
      use: [{
        loader: path.resolve(__dirname, '../../packages/webpack-uni-filter-loader')
      }]
    })

    const entry = {}
    if (isAppService) {
      entry['app-service'] = path.resolve(process.env.UNI_INPUT_DIR, getMainEntry())
    } else if (isAppView) {
      entry['app-view'] = path.resolve(process.env.UNI_INPUT_DIR, getMainEntry())
    }

    return {
      devtool,
      mode: process.env.NODE_ENV,
      externals: {
        vue: 'Vue'
      },
      entry () {
        return entry
      },
      output: {
        filename: '[name].js',
        chunkFilename: '[id].js',
        globalObject: 'this'
      },
      performance: {
        hints: false
      },
      resolve: {
        extensions: ['.nvue']
      },
      resolveLoader: {
        alias: {
          'vue-style-loader': path.resolve(__dirname, '../../packages/app-vue-style-loader')
        }
      },
      module: {
        rules: [{
          test: path.resolve(process.env.UNI_INPUT_DIR, getMainEntry()),
          use: [{
            loader: isAppService ? 'wrap-loader' : path.resolve(__dirname,
              '../../packages/webpack-uni-app-loader/view/main.js'),
            options: {
              compiler: getPlatformCompiler(),
              before: [
                beforeCode + statCode + getGlobalUsingComponentsCode()
              ]
            }
          }]
        },
        {
          resourceQuery: /vue&type=template/,
          use: [{
            loader: path.resolve(__dirname,
              '../../packages/webpack-uni-app-loader/filter-modules-template.js')
          }, {
            loader: path.resolve(__dirname,
              '../../packages/webpack-uni-app-loader/page-meta')
          }]
        },
        ...rules
          // v3 暂不支持 cache
          // createTemplateCacheLoader(api,
          //   isAppService
          //     ? 'uni-template-compiler-service'
          //     : 'uni-template-compiler-view'
          // )
        ]
      },
      plugins: [
        new webpack.ProvidePlugin(getProvides(isAppService))
      ]
    }
  },
  chainWebpack (webpackConfig, vueOptions, api) {
    webpackConfig.entryPoints.delete('app')

    const isAppService = !!vueOptions.pluginOptions['uni-app-plus']['service']
    const isAppView = !!vueOptions.pluginOptions['uni-app-plus']['view']

    const fileLoaderOptions = isInHBuilderX ? {
      emitFile: isAppView,
      name: '[path][name].[ext]',
      context: process.env.UNI_INPUT_DIR
    } : {
      emitFile: isAppView,
      outputPath (url, resourcePath, context) {
        return path.relative(process.env.UNI_INPUT_DIR, resourcePath)
      }
    }

    // 处理静态资源
    webpackConfig.module
      .rule('svg')
      .use('file-loader')
      .options(fileLoaderOptions)

    const staticTypes = ['images', 'media', 'fonts']
    staticTypes.forEach(staticType => {
      webpackConfig.module
        .rule(staticType)
        .use('url-loader')
        .loader('url-loader')
        .tap(options => Object.assign(options, {
          limit: 1,
          fallback: {
            loader: 'file-loader',
            options: fileLoaderOptions
          }
        }))
    })

    const cacheConfig = {
      cacheDirectory: false,
      cacheIdentifier: false
    }

    if (process.env.UNI_USING_CACHE) {
      Object.assign(cacheConfig, api.genCacheConfig(
        'vue-template-compiler/' + process.env.UNI_PLATFORM,
        getPartialIdentifier()
      ))
    }

    const compilerOptions = {
      isUnaryTag,
      preserveWhitespace: false,
      service: isAppService,
      view: isAppView
    }

    // disable vue cache-loader
    webpackConfig.module
      .rule('vue')
      .test([/\.vue$/, /\.nvue$/])
      .use('vue-loader') //  service 层移除 style 节点，view 层返回固定 script
      .loader(require.resolve('@dcloudio/vue-cli-plugin-uni/packages/vue-loader'))
      .tap(options => Object.assign(options, {
        isAppService,
        isAppView,
        compiler: getPlatformCompiler(),
        compilerOptions
      }, cacheConfig))
      .end()
      // .use('uniapp-custom-block-loader')
      // .loader(require.resolve('@dcloudio/vue-cli-plugin-uni/packages/webpack-custom-block-loader'))
      // .options({
      //   isAppService,
      //   isAppView,
      //   compiler: getPlatformCompiler()
      // })

    // 是否启用 cache
    if (process.env.UNI_USING_CACHE) {
      webpackConfig.module
        .rule('vue')
        .use('cache-loader')
        .tap(options => Object.assign(options, api.genCacheConfig(
          'vue-loader/' + process.env.UNI_PLATFORM,
          getPartialIdentifier()
        )))
    } else {
      webpackConfig.module
        .rule('vue')
        .uses
        .delete('cache-loader')
    }

    if (isAppView) {
      if (process.env.NODE_ENV === 'production') {
        require('../h5/cssnano-options')(webpackConfig)
      }
    }

    webpackConfig.plugins.delete('hmr')
    webpackConfig.plugins.delete('html')
    webpackConfig.plugins.delete('copy')
    webpackConfig.plugins.delete('preload')
    webpackConfig.plugins.delete('prefetch')
  }
}
if (process.env.UNI_USING_V3) {
  module.exports = v3
} else {
  module.exports = require('../mp')
}
